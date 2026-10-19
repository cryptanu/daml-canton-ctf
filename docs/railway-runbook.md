# Railway deployment runbook

Runs Damlnaut on Railway as four services built from this GitHub repo:
`postgres`, `canton`, `backend`, `gateway`. The frontend stays on Vercel (or
runs locally) and points at the backend's Railway domain.

**Verified:** the four Dockerfiles in `deploy/railway/` were built and run
locally in a Railway-style topology (separate services, env-driven config,
fresh Postgres): Canton 3.4.10 open-source image boots, backend seeds the
issuer, the gateway honors `PORT`, and a full Level 0 + Level 1 solve passes.

**Not verified:** anything on Railway itself. In particular: Railway
private-networking addressing (IPv4/IPv6), plan memory limits, volume
behavior, build settings names, and the wallet flow through Railway's public
domains. Steps marked **[verify]** may differ in the current Railway UI.

## Why these Dockerfiles

Railway builds from GitHub, so nothing local can be mounted:

- The Canton JAR is downloaded at image build time from the public Canton
  3.4.10 open-source release (it matches `daml.yaml`'s SDK 3.4.10).
- The DAR is committed at `packages/daml-canton-ctf-0.1.0.dar` (`.gitignore`
  excepts it). **Rebuild with `./damlw build`, copy into `packages/`, and
  commit it whenever the Daml sources change.** The backend uploads it at boot.
- There is no `depends_on`: Canton waits for Postgres in its entrypoint, and
  the backend retries until Canton's synchronizer is connected.

## 1. Push the branch

Railway deploys from GitHub, so the commits must be pushed first (the repo is
`cryptanu/daml-canton-ctf`, branch `live-wallet-flow`). Merge to `main` if you
want Railway to track `main`.

## 2. Create the project and services **[verify]**

New Project -> Deploy from GitHub repo -> select the repo. Create four services
from the same repo and name them exactly as below (variable references use
these names):

| Service | Root Directory | Dockerfile | Public domain | Volume |
|---|---|---|---|---|
| `postgres` | `/` | set `RAILWAY_DOCKERFILE_PATH=deploy/railway/postgres/Dockerfile` | **No** | mount `/var/lib/postgresql/data` |
| `canton` | `/` | set `RAILWAY_DOCKERFILE_PATH=deploy/railway/canton/Dockerfile` | **No** | none |
| `backend` | `/` | set `RAILWAY_DOCKERFILE_PATH=deploy/railway/backend/Dockerfile` | **Yes** | none |
| `gateway` | `/` | set `RAILWAY_DOCKERFILE_PATH=deploy/railway/gateway/Dockerfile` | **Yes** | mount `/gw/data` |

Never give `postgres` or `canton` a public domain. Canton's JSON API is
unauthenticated.

## 3. Variables

Use Railway reference variables so values stay in sync.

`postgres`
```
POSTGRES_PASSWORD=<random>
```
(The Dockerfile sets `POSTGRES_USER=canton` and runs `init.sql` to create the
four databases on first start. If you add the volume after the first deploy,
the init script has already run on an empty directory; if the databases are
missing, wipe the volume and redeploy.)

`canton`
```
POSTGRES_HOST=${{postgres.RAILWAY_PRIVATE_DOMAIN}}
POSTGRES_PASSWORD=${{postgres.POSTGRES_PASSWORD}}
```

`backend`
```
DAML_JSON_API_URL=http://${{canton.RAILWAY_PRIVATE_DOMAIN}}:7575
ADMIN_TOKEN=<random>
```
(`PORT` is injected by Railway; the app uses it.)

`gateway`
```
LEDGER_API_URL=http://${{canton.RAILWAY_PRIVATE_DOMAIN}}:7575
GATEWAY_CLIENT_SECRET=<random>
GATEWAY_ALLOWED_ORIGINS=https://<your-frontend-origin>
```

Deploy order: `postgres`, then `canton`, then `backend` and `gateway`.
Canton takes a few minutes the first time (it initialises its synchronizer).

## 4. Check it

```sh
curl -s https://<backend-domain>/api/health | python3 -m json.tool
```

Expect `canton.reachable: true`, `issuerReady: true`, `bootError: null`, both
`level-0` and `level-1` in `flagIssuers`. If `bootError` mentions a missing
synchronizer, wait and re-check. The backend retries on its own.

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://<gateway-domain>/login/              # 200
curl -s -o /dev/null -w "%{http_code}\n" https://<backend-domain>/api/admin/packages  # 401
curl -s -H "Authorization: Bearer <ADMIN_TOKEN>" https://<backend-domain>/api/admin/packages
```

## 5. Point the frontend and connect a wallet

1. Build the frontend with `VITE_DAMLNAUT_API_BASE=https://<backend-domain>`
   (locally: `VITE_DAMLNAUT_API_BASE=... npm run build && npx vite preview`;
   on Vercel: set the variable and redeploy).
2. Open the gateway UI at `https://<gateway-domain>/login/`. Log in with Client ID
   `damlnaut-user` and your `GATEWAY_CLIENT_SECRET`, then create a party.
3. In the app, click `connect canton wallet` and use the picker's **Custom
   Wallet URL**: `https://<gateway-domain>/api/v0/dapp`. (The built-in
   "Wallet Gateway (localhost, dev)" entry points at port 3030 on the local
   machine and will not work.)
4. Run Level 0, then Level 1 (ALPHA first, then another market).

**Unverified:** step 3 over Railway's HTTPS domain, including whether the
gateway needs a public-URL setting behind Railway's proxy. If the popup hangs,
read the `gateway` service logs.

## 6. Operations

| Task | How |
|---|---|
| Logs | Railway service -> Deployments -> View logs |
| Add/update a level | Rebuild the DAR, commit `packages/*.dar`, push; `backend` redeploys and re-uploads. Or POST `/api/admin/packages` after the DAR is in the image |
| Restart | Redeploy the service. Restarting `canton` is safe: state lives in Postgres |
| Backups | Back up the `postgres` volume and `gateway` volume. Use Railway's volume backups if available **[verify]**, plus `pg_dumpall` from a shell |
| Wipe | Deleting the `postgres` volume deletes the ledger, parties and flags |

## 7. Risks to check before sharing the link

- **Private networking addressing [verify]:** Canton binds `0.0.0.0`. If Railway's
  private network is IPv6-only for your environment, the backend and gateway
  cannot reach it. Check Railway's networking docs; if needed, bind Canton to
  `::` or add `-Djava.net.preferIPv6Addresses=true` via `JAVA_OPTS`.
- **Memory [verify]:** Canton runs with `-Xmx2g` (set via `JAVA_OPTS`). Make
  sure the plan allows at least ~3 GB for that service, or it will be killed.
- **Cost:** usage-based billing means a JVM running continuously costs real
  money; check current pricing before leaving it up.
- **Auth:** the gateway uses a shared client secret and Canton has no auth.
  Acceptable for a private demo only. Replace with a real identity provider
  and send a token from `LedgerContext` before a public link.
- **CORS:** backend CORS allows any origin. Restrict it to the frontend.
- **Rate limit:** `TRUST_PROXY_HOPS` defaults to 1. Railway adds proxy hops,
  so verify two clients from different IPs get separate buckets.
