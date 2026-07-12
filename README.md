# Daml Canton CTF

A beginner-friendly Daml/Canton security CTF inspired by Ethernaut-style levels.

Implementation notes for the current browser-driven session-wallet branch live at
[`docs/local-session-wallet-changes.md`](docs/local-session-wallet-changes.md).

Branch `CTF-dapp` runs the entire Level 0 loop on a **canton localnet** using the
Daml SDK JSON Ledger API v2 (Daml 3.4). No super validator, no external wallet,
no testnet. Everything lives on your machine.

## Architecture on this branch

```text
browser (Vite, :5173)
  ├── connect wallet ──► backend (Express, :8787)   allocates player party
  │                       │ POST /v2/parties         (Daml SDK JSON API)
  │                       ▼
  │                    canton sandbox (:7575, JSON Ledger API v2)
  │                       │
  ├── Ledger.create ─────►│  Level0Instance for the player
  ├── Ledger.exercise ───►│  SubmitLevel0 → FlagProof
  │                       │
  └── /api/levels/0/verify → backend as issuer:
                              queries FlagProof, exercises IssueFlag,
                              returns the resulting Flag record.
```

Only the issuer party is server-side. Everything else is signed by the browser
via the Daml SDK.

## What's live

- Frontend: compact wallet chip in the masthead, level list, Level 0 detail
  view with live execution card wired to the Daml SDK.
- Backend: Express service that owns the `damlnaut-issuer` party, seeds the
  `FlagIssuer` contract on boot, and mints the Level 0 flag via `IssueFlag`
  once a valid `FlagProof` appears.
- Daml: `Damlnaut.Level0.Level0Instance`, `Damlnaut.FlagIssuer.{FlagIssuer,
  FlagProof, Flag}`. Reference Daml Script under `daml/Solution.daml`.

## Local dev — three terminals

Terminal 1 — canton localnet (JSON Ledger API v2 on 7575):

```sh
./damlw build
canton sandbox \
  --json-api-port 7575 \
  --dar .daml/dist/daml-canton-ctf-0.1.0.dar
```

(If your `canton` binary isn't on PATH, use whatever launcher you normally
use — `daml start` works too as long as it exposes the JSON Ledger API on
7575 with no auth.)

Terminal 2 — Damlnaut backend + Vite frontend:

```sh
npm install
npm run dev
```

`npm run dev` runs backend on 8787 and Vite on 5173 concurrently.

Open http://localhost:5173.

Override the JSON Ledger API URL if needed:

```sh
DAML_JSON_API_URL=http://localhost:7575 npm run dev
```

## Level 0 flag submission walkthrough

1. Load http://localhost:5173. The masthead has a compact chip on the right:
   `● connect canton wallet`.
2. Click the chip. The frontend POSTs `/api/wallet/connect`. The backend calls
   `POST /v2/parties` on canton with a hint like `damlnaut-player-001` and
   hands back `{ party, jsonApiUrl, packageName, issuer }`.
3. The chip flips to `● canton-localnet · alice-name::abcd…ef`. All further
   ledger traffic goes browser ↔ canton on 7575 directly.
4. Click Level 0 in the ledger. The frontend calls `Ledger.query` looking for
   an existing `Level0Instance` with `player == connected party`; if none,
   it calls `Ledger.create`. The Level 0 detail view opens with instance CID
   populated.
5. Click **approve and solve**. The frontend submits a
   `POST /v2/commands/submit-and-wait` with an `ExerciseCommand` on the
   instance's `SubmitLevel0` choice. Canton returns an `updateId`. The card
   shows `updateId <id>` and the `proof` field fills with the new FlagProof
   CID.
6. The frontend then POSTs `/api/levels/0/verify` with the player id. The
   backend, acting as issuer, queries active contracts, finds the FlagProof
   for that solver, exercises `IssueFlag` on the seed FlagIssuer, and returns
   the resulting `Flag`. The card flips to `solved` and the `flag` field shows
   the flag value.

If it stalls: `curl http://localhost:8787/api/health` reports whether the
backend has bootstrapped the issuer. `bootError` there points at whatever
went wrong on 7575.

## Vercel deploy (frontend + backend as functions)

The `api/` folder holds a Vercel entrypoint that re-exports the same
Express app used locally. The frontend static bundle from `npm run build`
is served from `dist/`.

Canton itself is not deployed to Vercel — Vercel functions can't host a
long-running Canton participant. During pre-launch you tunnel to a local
Canton with ngrok (or cloudflared, tailscale funnel); once the docker /
VPS story from the scratchpad lands, you point `DAML_JSON_API_URL` at
the hosted participant instead.

Deploy:

```sh
# 1. Local: keep the sandbox running.
./damlw build
canton sandbox --json-api-port 7575 --dar .daml/dist/daml-canton-ctf-0.1.0.dar

# 2. New terminal: tunnel Canton to a public HTTPS URL.
ngrok http 7575
# copy the https URL, e.g. https://abc123.ngrok-free.app

# 3. Deploy.
vercel                        # first push, sets up the project
vercel env add DAML_JSON_API_URL   # paste the ngrok URL
vercel --prod                 # publish
```

The DSS demo URL is whatever Vercel prints — usually
`https://<project>.vercel.app`.

## Daml regression script

Runs independently of the localnet, purely via `daml script`:

```sh
./damlw test
# or
npm run ctf:test
```

## Files

```text
daml/Damlnaut/FlagIssuer.daml    shared proof + flag issuer templates
daml/Damlnaut/Level0.daml        level 0 challenge template
daml/Solution.daml               scripted regression proof (locked in UI)

shared/damlnaut.ts               constants + backend<->frontend types
shared/jsonLedgerApi.ts          minimal typed JSON Ledger API v2 client

src/main.tsx                     frontend app (compact wallet chip, Level 0)
src/canton/damlLedger.ts         browser-side Ledger wrapper
src/canton/templateMatch.ts      template-id tail matcher
src/styles.css                   visual system

server/index.ts                  Express API: /api/wallet/connect, /verify
server/ledgerContext.ts          issuer party bootstrap + verifier logic

daml.yaml                        Daml package config
scripts/check.sh                 daml script runner
```

## Current trade-off

- Dev-mode canton with no auth. Any client can submit as any party — fine on
  a laptop, unshippable in production.
- Player and issuer both live on the same participant. Real levels will need
  either external signing or separate participants.
- Level 0 is intentionally trivial: it exercises the entire dApp seam so
  future levels can focus on Daml logic bugs instead of infrastructure.

## Next candidate levels

1. Market Rebinding (locked, currently `level-1`).
2. Authorization Replay.
3. Oracle Proposal Replay.
4. Fragmented Holdings.
5. Residual Debt Liquidation.
