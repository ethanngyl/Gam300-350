/*!************************************************************************
\file migrate.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 03-11-2026
\brief
Database migrations. Each change to the database's tables is a numbered
file in migrations/ (001_baseline.js, 002_drop_uploads.sql, ...) that is
applied once, in order. The database records the last one applied in
PRAGMA user_version, so every database (a new one, a teammate's, the VM's)
ends up with the same tables. db.js runs this at startup; it can also be
run by hand (npm run migrate) on any database file, including a new empty
one.
A migration is either a .sql file (run as is) or a .js module exporting
up(db), a description and, for table rebuilds, foreignKeysOff = true.
Never edit a migration that has been committed: add a new one.
- loadMigrations(dir)
Async. Reads and checks the migrations folder: numbered 001, 002, ...
with no gaps.
- runMigrations(db, { backup, log, dir })
Async. Applies every migration newer than the database's user_version,
each in its own transaction. Backs the database up first (backup()) when it
already has tables. Throws, leaving the database at the last good version,
if a migration fails or the database is newer than this build.
- CLI: node migrate.js [--db <file>] [--status]
Migrates the file (default data/app.db, or DATA_DIR's), or with --status
only prints its version and what is pending.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { config } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = path.join(__dirname, 'migrations')
const MIGRATION_FILE_RE = /^(\d{3})_[\w-]+\.(js|sql)$/

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Reads the migrations folder.
  \param dir
    string, the folder (default migrations/ next to this file)
  \return
    Promise of [{ version, file, description, foreignKeysOff, up(db) }],
    sorted by version. Rejects if the numbering has a gap or a repeat.
*/
/************************************************************************/
export async function loadMigrations(dir = MIGRATIONS_DIR)
{
  const files = fs.readdirSync(dir).filter((name) => MIGRATION_FILE_RE.test(name)).sort()
  const migrations = []
  for (const file of files)
  {
    const version = Number(file.match(MIGRATION_FILE_RE)[1])
    if (version !== migrations.length + 1)
      throw new Error(`migrations/${file}: expected number ${String(migrations.length + 1).padStart(3, '0')} (no gaps or repeats)`)
    if (file.endsWith('.sql'))
    {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      const firstComment = sql.match(/^--\s*(.+)$/m)?.[1] ?? file
      migrations.push({ version, file, description: firstComment, foreignKeysOff: false, up: (db) => db.exec(sql) })
    }
    else
    {
      const module = await import(pathToFileURL(path.join(dir, file)).href)
      if (typeof module.up !== 'function') throw new Error(`migrations/${file} has no up(db) function`)
      migrations.push({
        version,
        file,
        description: module.description ?? file,
        foreignKeysOff: module.foreignKeysOff === true,
        up: module.up,
      })
    }
  }
  return migrations
}

/************************************************************************/
/*!
  \brief
    How many rows break a foreign key right now (PRAGMA foreign_key_check).
  \param db
    DatabaseSync
  \return
    number
*/
/************************************************************************/
function countForeignKeyProblems(db)
{
  return db.prepare('PRAGMA foreign_key_check').all().length
}

/************************************************************************/
/*!
  \brief
    Brings a database up to the newest migration.
  \param db
    DatabaseSync
  \param backup
    function, optional: makes a backup copy; called once, before the first
    migration, when the database already has tables
  \param log
    function, optional: gets one line per migration applied
  \param dir
    string, optional: another migrations folder (tests)
  \return
    Promise of the migrations applied ([{ version, file, description }])
*/
/************************************************************************/
export async function runMigrations(db, { backup = null, log = () => {}, dir = MIGRATIONS_DIR } = {})
{
  const migrations = await loadMigrations(dir)
  const current = db.prepare('PRAGMA user_version').get().user_version
  const newest = migrations.length
  if (current > newest)
    throw new Error(`the database is at version ${current}, newer than this build knows (${newest}). Update the code first.`)

  const pending = migrations.filter((m) => m.version > current)
  if (pending.length === 0) return []

  const hasTables = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).get().n > 0
  if (hasTables && backup) log(`backed up the database before migrating: ${backup()}`)

  const applied = []
  for (const migration of pending)
  {
    // foreign_keys can't change inside a transaction, so it is switched
    // around it. Problems that were already there don't stop the migration;
    // new ones (a rebuild that lost rows) do.
    const keysWereOn = db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1
    if (migration.foreignKeysOff) db.exec('PRAGMA foreign_keys = OFF')
    const problemsBefore = migration.foreignKeysOff ? countForeignKeyProblems(db) : 0
    db.exec('BEGIN')
    try
    {
      migration.up(db)
      if (migration.foreignKeysOff)
      {
        const problemsAfter = countForeignKeyProblems(db)
        if (problemsAfter > problemsBefore)
          throw new Error(`${problemsAfter - problemsBefore} row(s) would lose their foreign key`)
      }
      // Part of the same transaction: the version only moves if the migration succeeded.
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
    }
    catch (err)
    {
      db.exec('ROLLBACK')
      throw new Error(`migration ${migration.file} failed: ${err.message}`, { cause: err })
    }
    finally
    {
      if (migration.foreignKeysOff && keysWereOn) db.exec('PRAGMA foreign_keys = ON')
    }
    applied.push({ version: migration.version, file: migration.file, description: migration.description })
    log(`migration ${migration.file}: ${migration.description}`)
  }
  return applied
}

/************************************************************************/
/*!
  \brief
    Command line: node migrate.js [--db <file>] [--status]. Exits 1 on a
    failed migration.
*/
/************************************************************************/
async function main()
{
  const args = process.argv.slice(2)
  const dbIndex = args.indexOf('--db')
  const dbPath = path.resolve(dbIndex >= 0 && args[dbIndex + 1] ? args[dbIndex + 1] : path.join(config.dataDir, 'app.db'))
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  try
  {
    db.exec('PRAGMA foreign_keys = ON')
    const migrations = await loadMigrations()
    const current = db.prepare('PRAGMA user_version').get().user_version
    console.log(`${dbPath}: version ${current} of ${migrations.length}`)
    if (args.includes('--status'))
    {
      for (const m of migrations.filter((m) => m.version > current)) console.log(`  pending ${m.file}: ${m.description}`)
      return
    }
    const applied = await runMigrations(db, {
      backup: () => {
        const backupPath = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
        db.prepare('VACUUM INTO ?').run(backupPath)
        return backupPath
      },
      log: (line) => console.log(`  ${line}`),
    })
    console.log(applied.length ? `now at version ${migrations.length}` : 'already up to date')
  }
  catch (err)
  {
    console.error(err.message)
    process.exitCode = 1
  }
  finally
  {
    db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
// ----- End of Functions ----------------------------------------------------- //
