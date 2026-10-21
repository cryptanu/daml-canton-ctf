# Multi-participant Damlnaut stack

Two Canton participants on one synchronizer, so contracts really cross a
participant boundary:

- `participant1` (JSON API :7575) hosts the **issuer** (backend).
- `participant2` (JSON API :7576) hosts the **players** (Wallet Gateway connects here).
- One sequencer + one mediator, all four nodes in one JVM, Postgres storage.

**Verified locally (Docker, Apple Silicon):** bootstrap and `participant1` ping
`participant2`; backend seeds the issuer and uploads the DAR to both participants;
headless solve of Levels 0 and 1 with the player on participant2; player party
reported `isLocal=true` only on participant2 and the issuer only on participant1;
full restart (`down` then `up`, no `-v`) keeps the same issuer and the bootstrap
script is idempotent; Levels 0 and 1 solved through the real UI with the Wallet
Gateway (Level 1: ALPHA gives one losing proof and reopens exactly one position,
BETA gives the winning proof; the ledger shows exactly two Level 1 proofs, no
looping). **Not verified:** hosting on a VM, Railway, TLS, any
multi-operator / multi-JVM topology.

## Run

```sh
./damlw build   # DAR is committed under packages/, rebuild if Daml changes
docker compose -p dmulti -f deploy/multi/compose.yaml --env-file <env> up -d --build
```

`<env>` needs `POSTGRES_PASSWORD`, `ADMIN_TOKEN`, `GATEWAY_CLIENT_SECRET` and
`REPO_ROOT` (absolute repo path). On macOS Docker cannot bind-mount `~/Documents`;
this stack mounts nothing from the repo (everything is baked into images), so it
can run from anywhere, but keep the compose + env outside protected folders.

Backend: `DAML_JSON_API_URL` = participant1, `PLAYER_JSON_API_URL` = participant2.
When `PLAYER_JSON_API_URL` is unset the backend behaves as a single-participant setup.

## What changed in the app for this

- DARs are uploaded (and so vetted) on **every** participant.
- The gateway's ledger user (`damlnaut-user`) is created on the **player** participant.
- Level 1 position lookup reads as the **issuer** (observer of every `Position`)
  because the backend's participant cannot read as a party hosted elsewhere.
- Health reports both participants.

## Memory

All four nodes share one JVM (`JAVA_OPTS=-Xmx3g`). Plan for 4 GB or more.

## Isolation caveat (read before building privacy levels)

The browser/gateway read path queries with `filtersForAnyParty`, and the gateway's
single ledger user (`damlnaut-user`) holds rights on every player party. Canton is
therefore **not** isolating players from each other at the API level: only the app's
client-side `player == party` filter does. A client reading "as player" on
`participant1` (which does not host the player) still returned other parties'
visible contracts for the same reason. For levels where "who can see what" is the
exploit, query with `filtersByParty` only and use one ledger user per player.
