/*!************************************************************************
\file config.js
\author1 Xiong Yang
\author2 Gabriel Sebastian Putra
\par DP email1: xiong.yang@digipen.edu
\par DP email2: gabrielsebastian.p@digipen.edu 
\par Course: csd3401f26
\par Software Engineering Project 5
\date 30-09-2026
\brief
Central configuration for the reconstruction backend. It works out where the
COLMAP and Brush executables are, probes them once at startup for GPU support
and the right command-line flag, and exports a single config object that
every other backend file reads (ports, folders, tool paths, training knobs,
upload limits, python scripts, account mode). Any value can be overridden
with an environment variable, or in an optional .env file next to this
file (see .env.example), which is loaded first.
- findExe(roots, re, fallback)
Searches each root folder recursively, in order, for a file whose name
matches re. Returns the first match, or fallback if none is found. The
release zips extract into a subfolder whose name varies, so it searches
rather than hardcoding a layout.
- findOnPath(name)
Returns the absolute path of name if it is on the system PATH (e.g. a
Homebrew install), else null.
- findPython()
The Python interpreter to run the tools/ scripts with. On Windows it skips
the Microsoft Store "python.exe" stub that only says Python isn't
installed.
- colmapHasCuda(exe)
Runs COLMAP with -h and checks the output for "with CUDA". Decides whether
COLMAP should use the GPU when COLMAP_USE_GPU isn't set.
- readBrushHelp(exe)
Runs Brush with --help once; the flag probes read its output.
- brushItersFlag(help)
Finds out which iteration-count flag this build understands
(--total-steps or --total-train-iters).
- config
The exported settings object used by server.js, pipeline.js, scan.js and
status.js.
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Per-machine settings (AUTH_MODE, AUTH_API_KEY, ...) live in an optional,
// gitignored .env next to this file -- see .env.example. Loaded first so
// every process.env read below sees it.
const envFile = path.join(__dirname, '.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

// Repo root (this file lives at packages/src/backend/).
const repoRoot = path.join(__dirname, '..', '..', '..')
// Repo-local tool folder that tools/get-colmap.ps1 and tools/get-brush.ps1
// install into (gitignored, so each developer runs the scripts once).
const toolsDir = path.join(repoRoot, 'tools')
// Legacy/sibling location for developers who built the tools themselves.
const siblingToolsDir = path.join(repoRoot, '..', 'gsplat-tools')

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Find an executable by searching each root directory recursively, in
    order, for a file whose name matches `re`. The release zips extract
    into a subfolder whose name varies, so we search rather than hardcode
    a layout.
  \param roots
    string[]
    The folders to search, most specific first.
  \param re
    RegExp
    The pattern the executable's file name must match.
  \param fallback
    string
    The path to return if nothing is found.
  \return
    The first matching path, else fallback if none of the roots exist or
    contain one.
*/
/************************************************************************/
function findExe(roots, re, fallback) {
    for (const root of roots) {
        const stack = [root]
        while (stack.length) {
            const current = stack.pop()
            let entries
            try {
                entries = fs.readdirSync(current, { withFileTypes: true })
            } catch {
                continue
            }
            for (const e of entries) {
                const full = path.join(current, e.name)
                if (e.isDirectory()) stack.push(full)
                else if (re.test(e.name)) return full
            }
        }
    }
    return fallback
}

/************************************************************************/
/*!
  \brief
    Looks for an executable in every folder on the system PATH (e.g. a
    Homebrew install).
  \param name
    string
    The executable's file name.
  \return
    The absolute path of name if it's on PATH, else null.
*/
/************************************************************************/
function findOnPath(name) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir) continue
        const full = path.join(dir, name)
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full
    }
    return null
}

/************************************************************************/
/*!
  \brief
    Picks the Python interpreter for the tools/ scripts. On Windows,
    %LOCALAPPDATA%\Microsoft\WindowsApps often holds a python.exe stub
    that only prints "Python was not found" (exit code 9009); when it is
    earlier on PATH than a real install, plain `python` runs the stub. So
    the first python.exe outside WindowsApps is used. If there is none,
    `python` is kept as-is: Python installed from the Microsoft Store
    lives in WindowsApps and works there.
  \return
    string, an absolute path or a command name
*/
/************************************************************************/
function findPython() {
    if (!isWindows) return 'python3'
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        if (!dir || /[\\/]Microsoft[\\/]WindowsApps[\\/]?$/i.test(dir)) continue
        const full = path.join(dir, 'python.exe')
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full
    }
    return 'python'
}

// Windows builds ship .exe files; the macOS / Linux builds have no extension
// (COLMAP.app/Contents/MacOS/colmap, brush-app-*/brush_app).
const isWindows = process.platform === 'win32'
const exeSuffix = isWindows ? '.exe' : ''

// Resolve tool binaries. Precedence: explicit env var > repo-local tools/ (from
// get-tools.ps1 / get-tools.sh) > sibling ../gsplat-tools > PATH. More specific
// roots are listed first so a release build wins over a debug build.
const colmapBin =
    process.env.COLMAP_BIN ||
    findExe(
        [
            path.join(toolsDir, 'colmap'),
            path.join(siblingToolsDir, 'bin'),
            siblingToolsDir,
        ],
        isWindows ? /^colmap\.exe$/i : /^colmap$/,
        findOnPath(`colmap${exeSuffix}`) ||
        path.join(toolsDir, 'colmap', 'bin', `colmap${exeSuffix}`),
    )

const brushBin =
    process.env.BRUSH_BIN ||
    findExe(
        [
            path.join(toolsDir, 'brush'),
            path.join(siblingToolsDir, 'brush', 'target', 'release'),
            siblingToolsDir,
        ],
        isWindows ? /^brush.*\.exe$/i : /^brush[\w-]*$/i,
        findOnPath(`brush_app${exeSuffix}`) ||
        path.join(toolsDir, 'brush', `brush${exeSuffix}`),
    )

/************************************************************************/
/*!
  \brief
    Check if the COLMAP binary is a CUDA build by running it with `-h` and
    looking for "with CUDA" in its output.
  \param exe
    string
    The path to the COLMAP executable.
  \return
    bool, true if COLMAP was built with CUDA, false if not or if it
    couldn't be run.
*/
/************************************************************************/
function colmapHasCuda(exe) {
    try {
        const r = spawnSync(exe, ['-h'], {
            encoding: 'utf8',
            timeout: 10_000,
            windowsHide: true,
        })
        return /with CUDA/i.test(`${r.stdout ?? ''}${r.stderr ?? ''}`)
    } catch {
        return false
    }
}
// A CUDA build still says "with CUDA" on an AMD / Intel machine, and use_gpu=1
// then fails at feature extraction, so also require an NVIDIA driver.
// nvidia-smi ships with the driver on Windows and Linux; if it's missing or
// lists no GPUs, COLMAP runs on the CPU (the CUDA build handles that fine).
function hasNvidiaGpu() {
    try {
        const r = spawnSync('nvidia-smi', ['-L'], {
            encoding: 'utf8',
            timeout: 10_000,
            windowsHide: true,
        })
        return r.status === 0 && /^GPU \d+:/m.test(r.stdout ?? '')
    } catch {
        return false
    }
}
const colmapUseGpu =
    process.env.COLMAP_USE_GPU ??
    (colmapHasCuda(colmapBin) && hasNvidiaGpu() ? '1' : '0')

/************************************************************************/
/*!
  \brief
    Runs Brush with --help once, so the probes below can check which
    flags this build understands.
  \param exe
    string
    The path to the Brush executable.
  \return
    The help text, or '' if Brush couldn't be run.
*/
/************************************************************************/
function readBrushHelp(exe) {
    try {
        const r = spawnSync(exe, ['--help'], {
            encoding: 'utf8',
            timeout: 10_000,
            windowsHide: true,
        })
        return `${r.stdout ?? ''}${r.stderr ?? ''}`
    } catch {
        return ''
    }
}
const brushHelp = readBrushHelp(brushBin)

/************************************************************************/
/*!
  \brief
    Passing the wrong name makes Brush exit with code 2 before training
    starts. Ask the binary once which one it understands. Override with
    BRUSH_ITERS_FLAG if the probe can't run.
      v0.3.0 release : --total-steps
      main branch    : --total-train-iters
  \param help
    string
    Brush's --help output (see readBrushHelp).
  \return
    '--total-steps' if Brush's help lists it, else '--total-train-iters'.
*/
/************************************************************************/
function brushItersFlag(help) {
    if (/--total-steps\b/.test(help)) return '--total-steps'
    return '--total-train-iters'
}
const brushItersFlagName = process.env.BRUSH_ITERS_FLAG || brushItersFlag(brushHelp)

// --alpha-mode transparent makes the masked-out background count as empty
// space, so Brush removes splats there instead of ignoring them. Builds
// without the flag would exit on it, so it is only passed when listed.
const brushHasAlphaMode = /--alpha-mode\b/.test(brushHelp)

// COLMAP 4.x renamed the SiftExtraction/SiftMatching option namespaces to
// FeatureExtraction/FeatureMatching. Passing the wrong one makes COLMAP exit
// with "unrecognised option" before anything runs. Ask feature_extractor which
// it understands (both namespaces were renamed together, so the extractor's
// help settles the matcher too). Override with COLMAP_LEGACY_FLAGS=1 to force
// the old Sift* names, or =0 to force the new Feature* names, if the probe
// can't run (e.g. COLMAP not installed yet).
//   3.x : --SiftExtraction.use_gpu    / --SiftMatching.use_gpu
//   4.x : --FeatureExtraction.use_gpu / --FeatureMatching.use_gpu
function colmapUsesFeatureNamespace(exe) {
    try {
        const r = spawnSync(exe, ['feature_extractor', '--help'], {
            encoding: 'utf8',
            timeout: 10_000,
            windowsHide: true,
        })
        // spawnSync reports a missing/unrunnable binary via r.error (it does not
        // throw), so guard on that before reading the help text.
        if (r.error) return true // can't run COLMAP yet -> default to newer names
        const help = `${r.stdout ?? ''}${r.stderr ?? ''}`
        if (/--FeatureExtraction\.use_gpu/.test(help)) return true // 4.x
        if (/--SiftExtraction\.use_gpu/.test(help)) return false // 3.x
        return true // help didn't mention either -> default to newer names
    } catch {
        return true // default to the newer names the pipeline was written for
    }
}
const colmapLegacyFlags = process.env.COLMAP_LEGACY_FLAGS
const colmapUseFeatureNs =
    colmapLegacyFlags === '1' ? false
        : colmapLegacyFlags === '0' ? true
            : colmapUsesFeatureNamespace(colmapBin)
const colmapExtractionNs = colmapUseFeatureNs ? 'FeatureExtraction' : 'SiftExtraction'
const colmapMatchingNs = colmapUseFeatureNs ? 'FeatureMatching' : 'SiftMatching'

// Newer COLMAP builds moved the two-view inlier threshold into its own
// TwoViewGeometry namespace; older ones keep it with the matcher options.
// Ask exhaustive_matcher which one it lists (falls back to the matcher
// namespace if the probe can't run).
//   new : --TwoViewGeometry.min_num_inliers
//   old : --SiftMatching.min_num_inliers
function colmapMinInliersFlag(exe, matchingNs) {
    try {
        const r = spawnSync(exe, ['exhaustive_matcher', '--help'], {
            encoding: 'utf8',
            timeout: 10_000,
            windowsHide: true,
        })
        const help = `${r.stdout ?? ''}${r.stderr ?? ''}`
        if (/--TwoViewGeometry\.min_num_inliers/.test(help)) return '--TwoViewGeometry.min_num_inliers'
    } catch {
        // fall through to the older name
    }
    return `--${matchingNs}.min_num_inliers`
}

// Stricter COLMAP matching and camera solving. On low-texture, roughly
// symmetric objects (e.g. a plush on a turntable) the defaults accept weak
// matches between opposite sides, so some cameras land on the wrong side and
// the splat shows a ghost copy of the object -- different on every run.
// Requiring more inliers per photo pair and per added camera rejects those
// matches. Tested on 4 photo sets (15-82 photos); COLMAP_STRICT=0 turns it off.
const colmapStrict = process.env.COLMAP_STRICT !== '0'
const colmapStrictMatcherArgs = colmapStrict
    ? [
        colmapMinInliersFlag(colmapBin, colmapMatchingNs), '50',
        `--${colmapMatchingNs}.guided_matching`, '1',
    ]
    : []
const colmapStrictMapperArgs = colmapStrict
    ? [
        '--Mapper.init_min_num_inliers', '200',
        '--Mapper.abs_pose_min_num_inliers', '60',
        '--Mapper.abs_pose_min_inlier_ratio', '0.35',
    ]
    : []

/**
 * Central config for the reconstruction backend.
 *
 * Tool paths are resolved relative to the repo so a fresh clone works after
 * running tools/get-colmap.ps1 and tools/get-brush.ps1. Override any of these
 * with environment variables to point at a copy installed elsewhere.
 */
// A typo here must not quietly fall back to another mode (see authMode below).
const AUTH_MODES = ['local', 'client', 'authority']
const authMode = (process.env.AUTH_MODE || 'local').trim().toLowerCase()
if (!AUTH_MODES.includes(authMode)) {
    console.error(`[backend] AUTH_MODE="${process.env.AUTH_MODE}" is not one of: ${AUTH_MODES.join(', ')}`)
    process.exit(1)
}

export const config = {
    // HTTP port the API listens on (Vite proxies /api here in dev).
    port: Number(process.env.PORT) || 5005,

    // Where per-job working directories live (uploads, COLMAP db, splat output).
    jobsDir: process.env.JOBS_DIR || path.join(__dirname, 'jobs'),

    // Every finished job's result.ply is also copied here (see runPipeline), so
    // it shows up in the native engine's samples browser (engine/src/main.cpp)
    // without a manual copy step.
    engineSamplesDir:
        process.env.ENGINE_SAMPLES_DIR || path.join(repoRoot, 'engine', 'assets', 'samples'),

    // External tool executables (see resolution above).
    colmapBin,
    brushBin,

    // Training knobs. Fewer iterations = faster demo, lower quality.
    trainIters: Number(process.env.TRAIN_ITERS) || 10000,
    // Bounds for a per-job iteration cap sent by the site (Fast / Normal /
    // Detailed). Values outside are clamped.
    minTrainIters: 1000,
    maxTrainIters: 30000,
    maxResolution: Number(process.env.MAX_RESOLUTION) || 1024,
    // Name of Brush's iteration-count flag for the installed build (see above).
    brushItersFlag: brushItersFlagName,
    // Whether this Brush build accepts --alpha-mode (see above).
    brushHasAlphaMode,

    // Use the GPU for COLMAP SIFT (requires the CUDA build of COLMAP).
    colmapUseGpu,
    // GPU-toggle flags for the installed COLMAP (Sift* on 3.x, Feature* on 4.x).
    colmapExtractionUseGpuFlag: `--${colmapExtractionNs}.use_gpu`,
    colmapMatchingUseGpuFlag: `--${colmapMatchingNs}.use_gpu`,
    // Extra matcher / mapper options for stricter matching (see above); empty
    // when COLMAP_STRICT=0.
    colmapStrictMatcherArgs,
    colmapStrictMapperArgs,

    // Upload limits.
    maxFiles: 300,
    maxFileSizeMB: 30,
    // An uploaded .mp4 for the video extractor (kept only until its frames are
    // extracted). The web-app's MAX_VIDEO_MB (YoutubeIngest.jsx) should match.
    maxVideoSizeMB: Number(process.env.MAX_VIDEO_MB) || 1024,

    // --- Python post-processing / ingest scripts (repo tools/ dir) -------------
    // Interpreter used to run them. Needs `pip install -r tools/requirements.txt`
    // for the YouTube extractor (yt-dlp, opencv); normalize needs only stdlib.
    // macOS has no `python` command, only `python3` (start.sh sets PYTHON_BIN
    // to its virtualenv's interpreter).
    pythonBin: process.env.PYTHON_BIN || findPython(),
    // Extracts evenly spaced frames from a YouTube video (or, with --file, an
    // uploaded .mp4) into a job's images/. The yt* limits below apply to both.
    ytScript: process.env.YT_SCRIPT || path.join(toolsDir, 'youtube_frames.py'),
    // Default extraction rate (frames per second) and cap on frames pulled.
    ytFps: Number(process.env.YT_FPS) || 2,
    ytMaxFrames: Number(process.env.YT_MAX_FRAMES) || 200,
    // Upper bound on the requested extraction rate.
    ytMaxFps: 30,
    // Videos longer than this are refused before anything is downloaded.
    ytMaxDurationSec: Number(process.env.YT_MAX_DURATION) || 20 * 60,
    // Kill the download + extraction if it runs longer than this.
    ytTimeoutMin: Number(process.env.YT_TIMEOUT_MIN) || 30,
    // Recenters/rescales the trained splat into the viewer's frame.
    normalizeScript:
        process.env.NORMALIZE_SCRIPT || path.join(toolsDir, 'normalize_ply.py'),
    // Optional background removal: writes per-photo foreground masks that
    // COLMAP and Brush use to ignore the background (turntable captures).
    maskScript: process.env.MASK_SCRIPT || path.join(toolsDir, 'make_masks.py'),
    // rembg model used for the masks (see make_masks.py).
    maskModel: process.env.MASK_MODEL || 'isnet-general-use',
    // Cuts the object out of a photo with those masks, for the Library card
    // (GET /jobs/:id/cover.webp, see make_cover.py).
    coverScript: process.env.COVER_SCRIPT || path.join(toolsDir, 'make_cover.py'),

    // --- Shared library on the VM ----------------------------------------------
    // Client machines send each finished job (photos + result.ply) to the VM,
    // and every machine's Library lists the user's jobs from there.
    // This machine's name, stored with each job it sends (the job's "origin").
    machineName: process.env.MACHINE_NAME || os.hostname(),
    // The VM refuses new jobs when its disk has less free space than this.
    minFreeDiskGB: Number(process.env.MIN_FREE_DISK_GB) || 2,
    // How often a client retries sending finished jobs the VM hasn't got yet.
    syncIntervalMin: Number(process.env.SYNC_INTERVAL_MIN) || 5,
    // Largest result.ply the VM accepts from a client.
    maxResultSizeMB: 500,
    // Where finished jobs' photos and models are kept. 'disk' (default):
    // jobs/<id>/images/ and jobs/<id>_out/result.ply (plus a copy in the engine
    // samples folder). 'db': inside the database (app.db, tables job_images,
    // job_models and job_model_chunks), with no samples copy -- set
    // FILE_STORE=db on the VM only (ignored unless AUTH_MODE=authority).
    fileStore: process.env.FILE_STORE === 'db' ? 'db' : 'disk',

    // --- Account authority (centralized accounts on the VM) --------------------
    // 'local' (default): accounts live in this machine's own database, as
    //   before the VM existed. Safe default: 'client' deletes local accounts.
    // 'authority': this instance owns the accounts DB (only the VM). It serves
    //   /register and /verify-account, and its /auth/* routes use db.js directly.
    // 'client': this instance forwards signup/login to the authority.
    authMode,
    // Where the authority lives (only used in 'client' mode). No trailing slash.
    // Must be https:// (passwords are sent to it) unless allowInsecureAuth.
    vmAuthUrl: (process.env.VM_AUTH_URL || 'https://51-79-240-131.sslip.io').replace(/\/+$/, ''),
    // Shared secret between clients and the authority. MUST be set (same value)
    // on the VM and every client via AUTH_API_KEY. Empty means signup/login
    // refuse to run rather than silently accepting anything.
    authApiKey: process.env.AUTH_API_KEY || '',
    // AUTH_ALLOW_HTTP=1 lets a client send credentials to a plain http://
    // authority. Only for testing before HTTPS is set up on the VM.
    allowInsecureAuth: process.env.AUTH_ALLOW_HTTP === '1',
    // Express "trust proxy" setting. Set TRUST_PROXY=loopback on the VM, where
    // Caddy forwards from the same machine, so req.ip is the real client
    // address (for rate limits) and req.secure reflects HTTPS (for cookies).
    trustProxy: process.env.TRUST_PROXY || null,
    // --- Google SSO (authority only) -------------------------------------------
    // From the Google Cloud Console OAuth client (step 6). Secrets: put them in
    // .env, never commit them. Empty = Google sign-in is disabled.
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    // Must EXACTLY match an Authorized redirect URI registered in the console.
    googleRedirectUri:
        process.env.GOOGLE_REDIRECT_URI || 'https://51-79-240-131.sslip.io/auth/google/callback',
}