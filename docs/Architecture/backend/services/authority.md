# `backend/services/authority.js`

Business logic for **talking to the account authority (the VM) from a client machine**. There is no `req` or `res` here.

## Account modes (from `AUTH_MODE`)
- **local**: this machine's own database holds the accounts.
- **client**: a team machine. Sign-up and login are sent to the VM, and the account is mirrored locally with the VM's id.
- **authority**: the VM. It holds the account database and answers `/register`, `/verify-account` and `/library/...` for client machines that send the shared `AUTH_API_KEY`.

## Functions

### `callAuthority(endpoint, body)`
`POST <VM_AUTH_URL>/api/v1<endpoint>` with JSON and `X-Auth-Key`. It **gives up after 8 seconds**, so a VM that is down cannot leave the *Sign in* button spinning. Returns `{ status, data }`, where a reply that is not JSON gives `{}`. A network failure or timeout **throws**, and the route then answers 503.

### `clientAuthProblem()`
Why this machine cannot talk to the VM safely, or `null` if it can. It is checked before every call and logged once at startup:
- *"AUTH_API_KEY is not set"*;
- *"VM_AUTH_URL is not set"*;
- *"VM_AUTH_URL is not a valid URL"*;
- a **plain `http://`** address that is not `localhost`, `127.0.0.1` or `[::1]`, unless `AUTH_ALLOW_HTTP=1`, because passwords would cross the network unencrypted.

### `logAuthorityFailure(endpoint, status, data)`
Turns an unexpected VM reply into a log line that names the likely cause, so a setup mistake does not look like a wrong password:
- **401**: the VM rejected this machine's `AUTH_API_KEY` (the keys must match exactly);
- **503**: the VM is not running with `AUTH_MODE=authority`;
- anything else is logged with the status and the JSON reply.
