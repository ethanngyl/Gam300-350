#!/usr/bin/env bash
# ============================================================
#  Genesis backend - API smoke test (a second client)
#  Calls the backend's HTTP API with curl only, the way any other
#  app (mobile, the engine, Postman) would, and checks each reply's
#  status code. No browser and no database access: just the API.
#
#  Settings come from environment variables, or from api-tests/.env
#  (copy .env.example; .env is gitignored). Nothing is hard-coded:
#    API_BASE_URL   the backend, e.g. http://localhost:5005
#    API_EMAIL      an existing account's email
#    API_PASSWORD   its password
#  Optional:
#    API_PREFIX         the API version to test (default /api/v1; empty
#                       tests the legacy unversioned paths)
#    API_UPLOAD_DIR     a folder with 8+ .jpg/.png photos: uploads them
#                       (POST /upload), then cancels the job straight away
#    API_SEND_FEEDBACK  1 = send a feedback message (POST /feedback)
#
#  Run:  ./packages/api-tests/api-smoke.sh   (Windows: api-smoke.bat)
#  Exit code 0 when every check passes, 1 when any fails.
#
#  Written for the bash 3.2 that ships with macOS - no bash 4 features.
# ============================================================

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"

# Read api-tests/.env without overriding variables already set. Split on the
# first "=" only, so passwords may contain "=", spaces or "$".
if [ -f "$DIR/.env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in ''|'#'*) continue ;; esac
        key="${line%%=*}"
        value="${line#*=}"
        case "$key" in API_*) ;; *) continue ;; esac
        if [ -z "${!key:-}" ]; then export "$key=$value"; fi
    done < "$DIR/.env"
fi

if [ -z "${API_BASE_URL:-}" ] || [ -z "${API_EMAIL:-}" ] || [ -z "${API_PASSWORD:-}" ]; then
    echo "Set API_BASE_URL, API_EMAIL and API_PASSWORD (see api-tests/.env.example)."
    exit 2
fi
BASE="${API_BASE_URL%/}"
# Every path below is under this API version (docs/api-changelog.md).
PREFIX="${API_PREFIX-/api/v1}"

WORK="$(mktemp -d)"
JAR="$WORK/cookies.txt"
BODY="$WORK/body"
trap 'rm -rf "$WORK"' EXIT
PASSED=0
FAILED=0

# call METHOD PATH [curl options...] -> sets STATUS; the reply is in $BODY.
# PATH is under $PREFIX; call_legacy uses the unversioned path instead.
call() {
    local method="$1" path="$2"
    shift 2
    STATUS="$(curl -s -o "$BODY" -w '%{http_code}' -X "$method" -b "$JAR" -c "$JAR" "$@" "$BASE$PREFIX$path")"
}
call_legacy() {
    local method="$1" path="$2"
    shift 2
    STATUS="$(curl -s -o "$BODY" -w '%{http_code}' -X "$method" -b "$JAR" -c "$JAR" "$@" "$BASE$path")"
}

# check LABEL EXPECTED... -> passes if STATUS is one of the expected codes.
check() {
    local label="$1"
    shift
    local want
    for want in "$@"; do
        if [ "$STATUS" = "$want" ]; then
            echo "PASS  $label ($STATUS)"
            PASSED=$((PASSED + 1))
            return 0
        fi
    done
    echo "FAIL  $label (got $STATUS, expected $*): $(head -c 200 "$BODY" 2>/dev/null)"
    FAILED=$((FAILED + 1))
    return 1
}

# JSON string escaping for the login body.
json_escape() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

echo "Testing $BASE$PREFIX"
echo "--- signed out"
call GET /catalog
check "GET /catalog (reference data, public)" 200
if ! grep -q '"feedbackCategories"' "$BODY"; then
    echo "FAIL  ...the catalog has no feedbackCategories"
    FAILED=$((FAILED + 1))
fi
call GET /auth/me
check "GET /auth/me as a guest is refused" 401
call GET /jobs
check "GET /jobs as a guest is refused" 401
call POST /feedback -H 'Content-Type: application/json' --data '{"category":"other","message":"guest test message"}'
check "POST /feedback as a guest is refused" 401
call GET /no/such/endpoint
check "an unknown path answers 404 (JSON, not a page)" 404
if ! grep -q '"error"' "$BODY"; then
    echo "FAIL  ...the 404 reply is not JSON: $(head -c 120 "$BODY")"
    FAILED=$((FAILED + 1))
fi

echo "--- signing in"
EMAIL_JSON="$(json_escape "$API_EMAIL")"
call POST /auth/login -H 'Content-Type: application/json' --data "{\"email\":\"$EMAIL_JSON\",\"password\":\"wrong-password-for-the-smoke-test\"}"
check "POST /auth/login with a wrong password" 401
call POST /auth/login -H 'Content-Type: application/json' --data "{\"email\":\"$EMAIL_JSON\",\"password\":\"$(json_escape "$API_PASSWORD")\"}"
if ! check "POST /auth/login" 200; then
    echo "Can't sign in, so the remaining checks are skipped."
    echo "$PASSED passed, $((FAILED)) failed"
    exit 1
fi

echo "--- signed in"
call GET /auth/me
check "GET /auth/me" 200
if [ -n "$PREFIX" ]; then
    # API v1 sends dates as milliseconds; the legacy paths keep their ISO text.
    if ! grep -qE '"createdAt":[0-9]+' "$BODY"; then
        echo "FAIL  ...v1 createdAt is not a number: $(head -c 200 "$BODY")"
        FAILED=$((FAILED + 1))
    fi
    call_legacy GET /auth/me
    check "GET /auth/me on the legacy path still works" 200
    if ! grep -qE '"createdAt":"[0-9-]+T[0-9:]+Z"' "$BODY"; then
        echo "FAIL  ...legacy createdAt is not ISO text: $(head -c 200 "$BODY")"
        FAILED=$((FAILED + 1))
    fi
fi
call GET /auth/me/account
check "GET /auth/me/account" 200
call GET /auth/me/storage
check "GET /auth/me/storage" 200
call GET /jobs
check "GET /jobs" 200

# The first finished job in the list. Each job object starts with {"id":"...",
# and its fields up to the next "{" include hasResult.
JOB_ID="$(grep -oE '\{"id":"[0-9a-f-]{36}"[^{]*' "$BODY" | grep '"hasResult":true' | head -n 1 | sed -E 's/^\{"id":"([0-9a-f-]{36})".*/\1/')"
if [ -n "$JOB_ID" ]; then
    call GET "/jobs/$JOB_ID"
    check "GET /jobs/:id (finished job $JOB_ID)" 200
    STATUS="$(curl -s -o /dev/null -w '%{http_code}' -I -b "$JAR" "$BASE$PREFIX/jobs/$JOB_ID/result.ply")"
    check "HEAD /jobs/:id/result.ply" 200
    call GET "/jobs/$JOB_ID/result.ply" -H 'Range: bytes=0-4095'
    check "GET /jobs/:id/result.ply, first 4 KB (byte range)" 206
    if [ "$(head -c 3 "$BODY")" != "ply" ]; then
        echo "FAIL  ...the model doesn't start with \"ply\""
        FAILED=$((FAILED + 1))
    fi
else
    echo "SKIP  no finished model in this account, so the model checks were skipped"
fi
call GET /jobs/00000000-0000-0000-0000-000000000000
check "GET /jobs/:id for a job that doesn't exist" 404
call PATCH /jobs/00000000-0000-0000-0000-000000000000 -H 'Content-Type: application/json' --data '{"name":"x"}'
check "PATCH /jobs/:id for a job that doesn't exist" 404

echo "--- a scene: save, load, delete"
# An older (version 0) scene: the server saves it as format version 1.
SCENE='{"name":"API smoke test scene","background":"#18181b","renderMode":"splats","objects":[{"objectId":"o1","jobId":"sample-fox","name":"Fox","position":[1,0,-2],"rotation":[0,90,0],"scale":[1,1,1]}]}'
call POST /scenes -H 'Content-Type: application/json' --data "$SCENE"
if check "POST /scenes (a version 0 scene)" 201; then
    cp "$BODY" "$WORK/saved-scene"
    SCENE_ID="$(sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/' "$BODY")"
    if ! grep -q '"format":"genesis.scene","version":1' "$BODY"; then
        echo "FAIL  ...not saved as genesis.scene version 1: $(head -c 200 "$BODY")"
        FAILED=$((FAILED + 1))
    fi
    call GET "/scenes/$SCENE_ID"
    check "GET /scenes/:id" 200
    if cmp -s "$BODY" "$WORK/saved-scene"; then
        echo "PASS  ...loads exactly what was saved"
        PASSED=$((PASSED + 1))
    else
        echo "FAIL  ...what loaded differs from what was saved"
        FAILED=$((FAILED + 1))
    fi
    call DELETE "/scenes/$SCENE_ID"
    check "DELETE /scenes/:id" 204
    call GET "/scenes/$SCENE_ID"
    check "GET /scenes/:id after deleting it" 404
fi

if [ -n "${API_UPLOAD_DIR:-}" ]; then
    echo "--- upload (API_UPLOAD_DIR)"
    set --
    for photo in "$API_UPLOAD_DIR"/*.jpg "$API_UPLOAD_DIR"/*.jpeg "$API_UPLOAD_DIR"/*.png; do
        [ -f "$photo" ] && set -- "$@" -F "images=@$photo"
    done
    call POST /upload -F "trainIters=5000" "$@"
    if check "POST /upload ($(($# / 2)) photos)" 202; then
        UPLOAD_ID="$(sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/' "$BODY")"
        call GET "/jobs/$UPLOAD_ID"
        check "GET /jobs/:id for the new job" 200
        call DELETE "/jobs/$UPLOAD_ID"
        check "DELETE /jobs/:id cancels it" 200 409
        call DELETE "/jobs/$UPLOAD_ID/files"
        check "DELETE /jobs/:id/files removes it" 200
    fi
fi

if [ "${API_SEND_FEEDBACK:-}" = "1" ]; then
    echo "--- feedback (API_SEND_FEEDBACK=1)"
    call POST /feedback -H 'Content-Type: application/json' --data '{"category":"other","message":"API smoke test from api-tests/api-smoke.sh"}'
    check "POST /feedback" 201
fi

echo "--- signing out"
call POST /auth/logout
check "POST /auth/logout" 204
call GET /auth/me
check "GET /auth/me after logging out" 401

echo
echo "$PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
