# Hosted Damlnaut stack

Docker Compose: Postgres-backed Canton (sandbox bootstrap, SDK 3.4.10), the
Damlnaut backend, a Wallet Gateway (1.12.0, hashing scheme V2 to match Canton
3.4) and Caddy. Verified locally on Apple Silicon: full Level 0 + Level 1 solve
inside the stack, and issuer/parties preserved across `down` + `up`.
Not verified: a public VM, real DNS/TLS, a browser wallet through Caddy.

## Run

```sh
./damlw build                              # the backend image bakes .daml/dist/*.dar
cp deploy/hosted/.env.example deploy/hosted/.env   # fill in secrets, CANTON_JAR
docker compose -p damlnaut -f deploy/hosted/compose.yaml \
  --env-file deploy/hosted/.env up -d --build
```

Docker Desktop on macOS cannot bind-mount files under `~/Documents` (TCC).
If you hit `operation not permitted`, copy `compose.yaml init.sql storage.conf
Caddyfile .env` to a directory outside Documents and add `REPO_ROOT=/abs/path/to/repo`
to its `.env`. The Docker CLI also needs `/Applications/Docker.app/Contents/Resources/bin`
on PATH if `docker-credential-desktop` is not found.

- `api.<host>` -> backend (`/api/health`, `/api/levels/*`, `/api/admin/*`)
- `wallet.<host>` -> Wallet Gateway (login UI and dApp API)
- Canton's JSON API is **not** published. Only Caddy listens (`HTTP_PORT`, `HTTPS_PORT`).
- Set `API_SITE`/`WALLET_SITE` to real domains for automatic TLS.

## What the backend does at boot

Retries until Canton has a connected synchronizer, uploads the DAR, allocates
the issuer, seeds one FlagIssuer per level and creates the `damlnaut-user`
participant user the gateway grants party rights to.

## Before this is public

- Gateway uses a self-signed IdP with `GATEWAY_CLIENT_SECRET`. Anyone who knows it
  can log in. Replace with a real OIDC provider.
- Canton runs unauthenticated on the private network; backend `LedgerContext`
  does not send a token yet.
- Set a real `ADMIN_TOKEN`; restrict `GATEWAY_ALLOWED_ORIGINS` and backend CORS.
- Point the frontend at the API (`VITE_DAMLNAUT_API_BASE`) and give players the
  gateway URL via the wallet picker's Custom Wallet URL.
- Single VM, no backups: snapshot the `ledger-data` and `gateway-data` volumes.
