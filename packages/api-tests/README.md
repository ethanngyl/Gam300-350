# API smoke test

`api-smoke.sh` tests the backend's HTTP API on its own, with nothing but
`curl`: no browser, no React and no database access. It's a second client
that uses the same API as the website, alongside the engine's
`engine/src/net/BackendClient.cpp`.

## Setup

1. Make a test account on the backend you want to test (sign up on the website).
2. Copy `.env.example` to `.env` in this folder and fill in:
   - `API_BASE_URL`: the backend, for example `http://localhost:5005`
   - `API_EMAIL`, `API_PASSWORD`: the test account

   `.env` is gitignored. Environment variables with the same names work too,
   and take priority over `.env`.

## Run

- Windows: double-click `api-smoke.bat`, or run it from a terminal. It uses
  the Git Bash that comes with Git.
- macOS / Linux / Git Bash: `./api-smoke.sh`

Each check prints `PASS` or `FAIL` with the HTTP status. The exit code is 0
only when everything passes.

## What it checks

| Request | Expected |
|---|---|
| `GET /auth/me`, `GET /jobs`, `POST /feedback` signed out | 401 |
| An unknown path | 404 with a JSON `{ error }` |
| `POST /auth/login`, wrong password / right password | 401 / 200 (session cookie kept) |
| `GET /auth/me`, `/auth/me/account`, `/auth/me/storage`, `/jobs` | 200 |
| `GET /jobs/:id` for the account's first finished model | 200 |
| `HEAD /jobs/:id/result.ply` | 200 |
| `GET /jobs/:id/result.ply` with `Range: bytes=0-4095` | 206, starts with `ply` |
| `GET` / `PATCH /jobs/:id` for a job that doesn't exist | 404 |
| `POST /auth/logout`, then `GET /auth/me` | 204, then 401 |

Optional checks, off by default:

- **`API_UPLOAD_DIR`:** a folder with 8 or more photos. The script runs
  `POST /upload` (202), polls the new job (200), cancels it
  (`DELETE /jobs/:id`), then deletes it (`DELETE /jobs/:id/files`), so no
  model is trained.
- **`API_SEND_FEEDBACK=1`:** `POST /feedback` (201). The message is stored
  for the admins.

If the account has no finished model yet, the model checks are skipped.

The full list of endpoints is in [docs/architecture.md](../../docs/architecture.md).
