# Changelog

All notable changes to this project will be documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Backend uploads every DAR in `packages/` and `.daml/dist/` to the participant at boot (`POST /v2/packages`), so a fresh Canton needs no `--dar` flag. Disable with `DAR_AUTO_UPLOAD=0`.
- `GET/POST /api/admin/packages` (bearer `ADMIN_TOKEN`) lists / re-uploads DARs to hot-swap levels.
- `/api/health` now reports Canton reachability and package count.
- Rate limit on `/api/levels/*` (`RATE_LIMIT_PER_MIN`, default 30) and JSON request logging.
- Add `@walletconnect/sign-client` + `@walletconnect/types` (optional peers of `@canton-network/dapp-sdk`); without them the production bundle crashed at load with an unresolved import.
- `scripts/demo-solve.mts`: headless end-to-end solve of Levels 0 and 1; `docs/walkthrough.mp4`: narrated platform walkthrough.
- Upgrade `@canton-network/dapp-sdk` to 1.8.0: 1.4.0 lacked the origin-broadcast handshake that Wallet Gateway 1.12 login waits for, so the gateway popup hung on "Loading networks…".
- Remove retired stubs; add GitHub Actions typecheck + build.

## [0.2.0] — 2026-07-08

Move the entire Level 0 loop off the mock provider onto a real Canton
localnet, replace the vendor wallet-SDK with the Daml SDK JSON Ledger API v2,
give the frontend a real local session wallet, and slim the UI so nothing
about the wallet takes a modal-sized bite of the screen.

### Added

- **Daml SDK client** (`shared/jsonLedgerApi.ts`). A minimal typed client for
  Canton's JSON Ledger API v2: `POST /v2/parties`,
  `POST /v2/commands/submit-and-wait`, `POST /v2/state/active-contracts`,
  `GET /v2/state/ledger-end`. Same surface on server and browser.
- **Backend issuer wallet** (`server/ledgerContext.ts`). On boot, resolves
  or allocates a stable `damlnaut-issuer` party and seeds a `FlagIssuer`
  for `level-0`. Caches the CID. `verifyLevel0` exercises `IssueFlag`
  against the player's on-ledger `FlagProof`.
- **JSON Ledger API reverse proxy** (`server/index.ts`, mounted at
  `/api/ledger`). Canton's JSON API does not emit CORS headers; the
  browser goes through the backend so everything stays same-origin.
- **Local session wallet.** `POST /api/wallet/connect` allocates a fresh
  player party with a 6-char base36 random suffix; browser saves the
  party id to `localStorage['damlnaut:wallet:v1']`. On subsequent visits,
  `POST /api/wallet/resume` verifies the party still exists on the
  participant and rebuilds the client transparently. Same laptop, same
  browser, same party across refreshes and restarts of the backend.
- **Solved-state rehydration.** `bootstrapLevel0` queries for an existing
  `Flag` visible to the player before touching the instance; if found,
  the level jumps straight to `solved` with the stored flag value —
  no wasted create.
- **Stale-instance guard on solve.** `SubmitLevel0` is a consuming choice,
  so the instance is archived on the first solve. Retrying now re-checks
  the ledger and rebootstraps in-place instead of 404-ing on the archived
  contract id.
- **Compact wallet chip.** Replaces the old 3-column wallet-dock card.
  Dot + network + short party id + × in the masthead. Idle/connecting/
  connected/error visually distinct via dot colour. Tooltip labels the
  wallet honestly as a *local session wallet* — not external signing.
- **`CHANGELOG.md`** — this file.
- **`typecheck` npm script** so CI (or you) can run `npm run typecheck`.

### Changed

- Frontend now uses `@daml/types` for primitive types and the local
  `jsonLedgerApi` client for everything else. `main.tsx`, `damlLedger.ts`
  and the level components read like idiomatic Daml SDK code
  (`ledger.create`, `ledger.exercise`, `ledger.query`).
- `WalletConnectResponse.jsonApiUrl` now points at the backend's proxy
  mount, not Canton directly, so browsers never see CORS.
- Player party hint is `${hint}-${randomSuffix}` instead of an incrementing
  counter, so `POST /v2/parties` no longer collides after backend restart.
- Backend endpoint `POST /api/wallet/resume` short-circuits with a 400 on
  missing party before touching Canton — malformed requests get a clean
  error even when the sandbox is down.
- `README.md` rewritten around the localnet architecture, three-terminal
  dev workflow, and full Level 0 flag submission walkthrough.
- `tsconfig.json` now includes `shared/` and `server/`; `ignoreDeprecations:
  "6.0"` silences the deprecated `moduleResolution=node10` warning until
  a bigger tsconfig sweep.

### Removed

- `@canton-network/dapp-sdk` and `@canton-network/core-splice-provider`.
  The dApp-SDK is a wallet-connect protocol layer that expects a real
  wallet provider on the other side — we don't have one yet, and Anu
  wanted the Daml SDK path instead.
- `@daml/ledger` (npm v2.10). Speaks the deprecated JSON API v1;
  Canton 3.4 only exposes v2. Kept `@daml/types` for `Party`/`Text`
  semantic labels.
- `src/canton/mockProvider.ts` and `server/mockLedger.ts` — retired to
  stubs (`export {}`) so any lingering imports break loudly. Delete
  cleanly with `git rm` when convenient.
- `.wallet-dock`, `.wallet-copy`, `.wallet-meta`, `.wallet-pill`,
  `.wallet-actions` and their mobile media-query rules — replaced by the
  much smaller `.wallet-chip` family.

### Fixed

- **CORS-blocked ledger reads.** Browser calls to `http://localhost:7575`
  now go through `http://localhost:8787/api/ledger/*`, resolving the
  `Failed to fetch` on Level 0 bootstrap right after connect.
- **`Party already exists` on reconnect after backend restart.** Random
  party suffix instead of the `connectSeq` counter that reset to 0 on
  every backend boot and collided with previously-allocated parties.
- **`CONTRACT_NOT_FOUND` on solve retry.** Consuming `SubmitLevel0`
  archives the instance; the frontend now revalidates before every
  submit and re-bootstraps if the cached CID is gone.
- **Stale proof/flag/updateId after refresh.** `bootstrapLevel0`'s success
  path now writes a complete state object instead of spreading `current`,
  so the UI trail is reset alongside the new instance.

### Notes

- This is still a **local session wallet**, not external signing. The party
  is allocated by the backend; there is no keypair on the client. Same
  browser gets the same party back, but different browsers or another
  device do not. External signing is a separate track — see the About
  view in-app for the exact caveat.
- Runs against a Canton 3.4 sandbox with no auth. Terminal 1:
  `./damlw build && canton sandbox --json-api-port 7575 --dar .daml/dist/daml-canton-ctf-0.1.0.dar`.
  Terminal 2: `npm run dev`.

## [0.1.0] — earlier

Initial CTF-dapp branch: mock Canton wallet provider (`@canton-network/
dapp-sdk`), in-memory `MockLedger`, three-column wallet dock, level list,
Level 0 detail view. Frontend + backend loop working end-to-end against
mocks. Daml Script regression under `daml/Solution.daml`.

[0.2.0]: https://github.com/cryptanu/daml-canton-ctf/compare/CTF-dapp...feat/local-session-wallet
[0.1.0]: https://github.com/cryptanu/daml-canton-ctf/tree/CTF-dapp
