# Local Session Wallet Changes

This note documents the changes currently carried on branch `feat/local-session-wallet`.

Live deployment for this branch:
[https://daml-canton-ctf.vercel.app/](https://daml-canton-ctf.vercel.app/)

## Goal

Turn Damlnaut from a local-only code-and-script challenge into a browser-driven Canton dApp demo:

- a user opens the site
- connects a lightweight session wallet
- gets a Canton party allocated for that browser session
- opens a level
- executes the solve flow through the Daml JSON Ledger API v2
- asks the backend verifier to confirm the on-ledger proof
- sees the level marked solved in the UI

This branch still uses a local Canton participant and does **not** use a real external wallet yet.

## Core architecture

The current flow is:

```text
browser UI
  -> POST /api/wallet/connect
  -> backend allocates a player party
  -> browser stores the party in localStorage
  -> browser talks to Canton through the backend ledger proxy
  -> browser creates / exercises Daml contracts
  -> backend verifier, acting as issuer, checks FlagProof and mints Flag
```

Important split:

- browser acts as the player
- backend acts as the issuer / verifier
- Canton remains the source of truth

## Daml layer

### Level 0

Level 0 remains the bootstrap challenge:

- create `Level0Instance`
- exercise `SubmitLevel0`
- produce `FlagProof`
- let the backend issuer exercise `IssueFlag`

### Level 1

Added `daml/Damlnaut/Level1.daml` and `daml/SolutionLevel1.daml`.

Level 1 demonstrates market rebinding:

- backend seeds Alpha and Beta markets
- browser opens a `Position` against Alpha
- vulnerable `Settle` flow accepts a caller-supplied market CID
- solving with Beta produces the expected proof for the issuer

## Shared client/server contract types

Expanded `shared/damlnaut.ts` with:

- level constants
- module/entity identifiers
- wallet connect / resume request-response shapes
- Level 1 bootstrap and verification response shapes
- flag, proof, market, and position payload types

This keeps frontend and backend aligned on the same wire format.

## Browser wallet/session model

Implemented a local session wallet in `src/canton/damlLedger.ts`:

- `connectWallet()` allocates a party through the backend
- `resumeWallet()` restores an earlier party if it still exists
- session is persisted in `localStorage`
- browser-side ledger wrapper submits commands through the JSON Ledger API v2

This is intentionally a lightweight local-session model, not external signing.

## Frontend

Updated `src/main.tsx` and `src/styles.css` to support:

- compact wallet chip in the masthead
- automatic session resume
- Level 0 live execution card
- Level 1 live execution card
- market selector for the rebinding exploit
- solved / verifying / bootstrapping state transitions
- light/dark mode retention

Important production fix:

- local dev still defaults the backend to `http://<host>:8787`
- production now uses `window.location.origin`
- optional override remains available through `VITE_DAMLNAUT_API_BASE`

Without that change, the hosted frontend tried to call port `8787` from the public browser and wallet connect failed.

## Backend

Split the backend into:

- `server/app.ts` for the shared Express app
- `server/index.ts` for local development startup
- `server/ledgerContext.ts` for issuer bootstrapping, level seeding, and verification

Current backend responsibilities:

- expose `/api/health`
- allocate / resume wallet parties
- proxy the JSON Ledger API through `/api/ledger`
- bootstrap Level 1 markets
- verify Level 0 and Level 1 proofs
- seed and cache `FlagIssuer` contracts

## Vercel/serverless work

Added:

- `api/[...path].ts`
- `api/index.ts`
- `api/ping.ts`
- `vercel.json`

Key deployment fixes:

### 1. ESM import resolution

Vercel's Node runtime did not reliably resolve extensionless runtime imports used by local `tsx`.

Fixed by switching server/runtime imports to explicit `.js` extensions in:

- `api/[...path].ts`
- `server/app.ts`
- `server/index.ts`
- `server/ledgerContext.ts`

### 2. Catch-all packaging

The catch-all function now statically imports `server/app` so Vercel bundles the backend into the serverless function.

### 3. Multi-segment API routing

Vercel initially routed only one path segment under `/api`.

Effect:

- `/api/health` worked
- `/api/wallet/connect` and `/api/levels/0/verify` returned Vercel 404s

Fixed by adding an explicit rewrite in `vercel.json`:

- `/api/:path* -> /api/[...path]`

### 4. Health and smoke checks

Validated production behavior with:

- `/api/ping`
- `/api/health`
- `/api/wallet/connect`
- `/api/levels/0/verify`

## Operational notes

Current hosted demo still depends on a reachable Canton JSON API endpoint.

Current public URL:

- `https://daml-canton-ctf.vercel.app/`

For the present setup:

- frontend and backend are hosted on Vercel
- Canton is not hosted on Vercel
- the Vercel backend points to a tunnel or remote participant via `DAML_JSON_API_URL`

If that tunnel disappears, the site shell still loads but wallet and level actions will stop working.

## Files added or materially changed

- `README.md`
- `.env.example`
- `.gitignore`
- `tsconfig.json`
- `vercel.json`
- `api/[...path].ts`
- `api/index.ts`
- `api/ping.ts`
- `server/app.ts`
- `server/index.ts`
- `server/ledgerContext.ts`
- `shared/damlnaut.ts`
- `src/canton/damlLedger.ts`
- `src/main.tsx`
- `src/styles.css`
- `daml/Damlnaut/Level1.daml`
- `daml/SolutionLevel1.daml`

## Current tradeoffs

- no real wallet integration yet
- no external signing
- localStorage session persistence is convenient but not security-hard
- hosted demo still depends on a tunnel or separately hosted Canton endpoint
- backend remains trusted for issuer-side verification and level bootstrapping

## Next logical step

If the next branch introduces a real Canton wallet:

- browser session allocation should become optional or disappear
- signing authority should move out of the backend-local session model
- the ledger proxy and verification boundaries should be revisited
