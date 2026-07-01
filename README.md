# Daml Canton CTF

A beginner-friendly Daml/Canton security CTF inspired by Ethernaut-style levels.

The first demo is intentionally lightweight: the GitHub repository remains private, the frontend runs locally, there is no login, and Level 0 uses client-side flag validation. This is enough to demonstrate the product loop before adding a hosted Canton/Daml backend.

## What Exists Now

### Web Demo

The React/Vite frontend provides:

- A homepage with available level tiles.
- A Level 0 challenge page.
- Full Daml source display.
- Local run instructions.
- A flag submission box.
- Client-side validation for the Level 0 flag.

Run it locally:

```sh
npm install
npm run dev
```

Then open the URL printed by Vite, usually:

```text
http://localhost:5173
```

Build the frontend:

```sh
npm run build
```

### Level 0: Local Submit

Objective:

```text
Run the local Daml solution script, create a proof contract, and copy the demo flag printed by the local harness.
```

There is no wallet setup for Level 0. In the local MVP, the player identity is a Daml `Party` allocated by Daml Script.

The script:

1. Allocates a player party.
2. Creates a `Level0Instance`.
3. Exercises `SubmitLevel0`.
4. Receives a `FlagProof` contract.
5. Asserts that the proof is tied to the expected level and instance.

Run the Daml check:

```sh
./damlw test
```

Or:

```sh
npm run ctf:test
```

Expected result:

```text
daml/Solution.daml:solveLevel0: ok
```

## Files

```text
daml/Damlnaut/Level0.daml  # challenge templates
daml/Solution.daml         # local MVP reference script (not shown in the web source panel)
src/main.tsx                # frontend app
src/styles.css              # frontend visual system
daml.yaml                   # Daml package config
scripts/check.sh            # Daml test runner
```

## Current Tradeoff

This initial version does **not** attempt cheating resistance.

That means:

- The demo flag is printed by the local check script, not embedded in the displayed challenge source.
- The browser validates the submitted flag client-side.
- This is suitable for an Amar/OZ demo of the UX and CTF concept.
- It is not suitable for a public competitive CTF yet.

A later hosted version should move validation behind a backend:

```text
Create Instance -> Exploit Instance -> Submit Proof -> Backend Validates Ledger State -> Backend Returns Flag
```

## Design Direction

Future levels should follow an Ethernaut-like flow:

```text
Create Instance -> Read Source -> Exploit Daml Contract Flow -> Submit Flag
```

Candidate next levels:

1. Market Rebinding
2. Authorization Replay
3. Oracle Proposal Replay
4. Fragmented Holdings
5. Residual Debt Liquidation
