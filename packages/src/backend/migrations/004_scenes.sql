-- add the scenes table (Scene Builder scenes saved on the server)
-- document is the whole scene as JSON in the versioned scene format
-- (schemas/scene.v1.schema.json); format_version repeats its version so old
-- scenes can be found without reading every document. Dates are UTC epoch
-- milliseconds. Deleting the account deletes its scenes.
CREATE TABLE IF NOT EXISTS scenes (
  id             TEXT PRIMARY KEY,
  owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  document       TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scenes_owner ON scenes(owner_id, updated_at);
