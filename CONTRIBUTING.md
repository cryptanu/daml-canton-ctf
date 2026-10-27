# Contributing a level to Damlnaut

Thanks for wanting to add a level. This guide is the style guide for pull requests
that add or change a **game level**. It is based on how Levels 0 and 1 are built, so
follow those two as the reference implementations.

A level is **one deliberately flawed Daml contract plus a verifier**. The player
finds the flaw, exploits it through a Canton wallet, and the verifier hands out a flag.

> **Status of this project.** Two levels are live (00 The bare proof, 01 Market
> Rebinding). Level 02 is next. Everything else is a proposal. Open an issue before
> you build, so we do not both build the same level.

---

## 1. Before you write code: propose the level

Open an issue titled `Level proposal: <name>` with:

| Field | What to write |
|---|---|
| **Bug class** | One sentence, for example "propose/accept replay via a `nonconsuming` choice" |
| **Source** | Where the pattern comes from (audit, CVE, curriculum section, your own find) |
| **Win condition** | The observable state the verifier checks, in one sentence |
| **Control case** | What a *wrong* attempt does (a plausible attempt that must **not** win) |
| **Difficulty** | Warm-up, easy, medium, hard (see section 3) |
| **Fix** | The change that closes the bug |

If the level is based on someone else's material, name it and keep their license notice
(for example the MIT-licensed
[Canton/Daml auditor bootcamp](https://github.com/gdroz3r/Canton-daml-auditor-bootcamp)).

---

## 2. What makes a good level

1. **One flaw per level.** If you find a second bug while building, fix it or make it a
   separate level. An *unintended* second bug makes the level unfair.
2. **Mechanical win condition.** The contract itself creates a `FlagProof` whose `proof`
   string depends on whether the exploit worked. The verifier only checks that string.
   (Level 1: `market-not-rebound` loses, `market-rebound` wins.) No human judgement.
3. **A control that fails.** There must be an obvious wrong attempt that produces a
   non-winning proof. This teaches the player that the check really is the bug.
4. **Realistic.** The flaw should look like something an auditor would see in a real
   Daml application. Avoid puzzles that only exist in the game.
5. **Teaches one thing.** State in the PR what a player learns. If you cannot say it in a
   sentence, split the level.
6. **Self-contained.** No external services, no secrets, no network calls beyond the
   Canton ledger the game already uses.
7. **Fix is known.** Write the fix down, and check that applying it makes the exploit fail.

**Flags are not secrets.** Flag values live in `shared/damlnaut.ts`, which is bundled
into the browser. They prove completion; the challenge is the exploit. Do not build a
level whose difficulty relies on hiding the flag.

**Privacy levels need extra care.** Players currently share one participant and one
ledger user, and the app reads with `filtersForAnyParty`, so Canton does not isolate
players from each other at the API level. A level where "who can see what" is the exploit
must say how it will work, and must be tested. Open an issue first.

---

## 3. Difficulty labels

| Label | Meaning |
|---|---|
| warm-up | Follow the on-screen steps |
| easy | One missing check; the hint points near it |
| medium | The exploit needs a non-obvious input, such as passing a different contract id |
| hard | Needs reasoning about authority, visibility or multi-step flows; little or no hint |

Level text should match the difficulty: harder levels describe the *goal*, not the
mechanism.

---

## 4. The files a level touches

Use Level 1 as the template. A complete level changes these places:

| Area | File | What to add |
|---|---|---|
| Daml | `daml/Damlnaut/LevelN.daml` | Module `Damlnaut.LevelN`, imports `Damlnaut.FlagIssuer`, creates a `FlagProof` with `level = "level-N"` |
| Daml tests | `daml/SolutionLevelN.daml` | Daml Script scenarios: the winning exploit, and every control that must not win |
| Shared config | `shared/damlnaut.ts` | `LEVELN_LEVEL_TAG`, `LEVELN_EXPECTED_PROOF`, `LEVELN_FLAG_VALUE`, record types, and one entry in `LEVEL_ISSUER_CONFIGS` |
| Backend | `server/ledgerContext.ts`, `server/app.ts` | `/api/levels/N/verify` (and `/bootstrap` if the level needs seeded contracts), following `verifyGeneric` |
| Wallet client | `src/canton/liveWallet.ts` | One method per signed wallet action; **every command uses `nonce()`** in its `commandId` (see below) |
| UI | `src/main.tsx`, `src/styles.css` | A `LEVELS` entry (`id`, `index`, `title`, `desc`, `status`, `summary`, `objective`, `files`, `steps`, `logLines`) and the level view |
| Package | `packages/daml-canton-ctf-<version>.dar` | **Rebuild with `./damlw build` and commit the DAR.** Railway builds from GitHub, where `.daml/` is not available |
| Changelog | `CHANGELOG.md` | One line under `[Unreleased]` |

Notes that save review time:

- **Unique command ids.** Canton rejects a repeated command id within its dedup window as
  `DUPLICATE_COMMAND`, even when the first attempt succeeded. Never use a fixed id.
- **Consuming choices remove the contract.** If a choice consumes the player's contract,
  decide explicitly what the UI does next. Do not let an effect re-run a bootstrap on
  every state change (that caused an infinite re-open bug in Level 1).
- **Read as the right party.** The backend's participant may not host the player. Read the
  issuer's view (the issuer should be an observer of what it must verify).
- **Seed idempotently.** Bootstrap endpoints must be safe to call twice.
- Daml SDK is pinned to **3.4.10**, LF target 2.2 (`daml.yaml`). Do not bump it in a level PR.

---

## 5. Daml style

- Module and file names: `Damlnaut.LevelN` in `daml/Damlnaut/LevelN.daml`.
- Start the file with a comment block: the level name, the intentional flaw, and the fix
  ("Do not add it here. The level is intentionally broken."), as in `Level1.daml`.
- Mark the vulnerable line with a comment naming the missing check.
- Keep templates small. Use the fewest parties that make the bug real.
- Do not leave compiler warnings, unused imports or dead code.
- Choice and field names describe the domain, not the bug. Do not name a choice
  `VulnerableSettle`.

---

## 6. Tests and evidence (required)

Run all of these before you open the PR:

```sh
./damlw build
./damlw test                  # your SolutionLevelN scenarios: win passes, controls fail
npm ci
npm run typecheck
npm run build
```

CI runs `typecheck` and `build`. It does **not** run the Daml tests or the wallet flow, so
you must, and you must show it.

Paste in the PR:

1. The `./damlw test` output for your scenarios.
2. Evidence that the exploit works against a real ledger (run `scripts/demo-solve.mts`
   extended for your level, or a screenshot of the solved level through the UI).
3. Evidence that the fix works: apply the one-line fix locally and show the exploit now fails.
4. The control case result (the non-winning proof).

For a full local network, see `deploy/multi/README.md`.

---

## 7. Pull request style

**Branch name:** `feat/level-N-short-name`, for example `feat/level-2-authorization-replay`.

**One level per PR.** Keep refactors, dependency bumps and unrelated fixes in separate PRs.

**Title:** imperative, sentence case, no trailing period. Match the existing history.
Good: `Add Level 2: Authorization Replay`. Bad: `level 2 stuff`.

**Commits:** imperative subject, 72 characters or fewer; explain the *why* in the body when
it is not obvious. Do not commit secrets, `.env` files, `scratchpad.md` or `dist/`.

**Description:** use the template in `.github/PULL_REQUEST_TEMPLATE.md`. In short:

- *What* the level teaches and who it is for
- *Bug class* and source
- *How to win* (one paragraph; the full solution lives in `SolutionLevelN.daml`)
- *Control case*
- *The fix*
- *Evidence* (section 6)
- *Screenshots* of the UI, light and dark if you touched styles

**Spoilers.** This repository is public, so solutions in `daml/Solution*.daml` and in
PR text are visible to everyone. Keep long walk-throughs out of the PR description and
point to the Solution file. Maintainers may later move solutions elsewhere.

---

## 8. What reviewers check

- The exploit works and nothing else wins (no second bug).
- The control case really fails, and the fix really closes the bug.
- The level text fits the difficulty and does not give the answer away early.
- Commands use unique ids; consuming choices are handled; bootstrap is idempotent.
- DAR, tests, types and docs are all updated together.
- No secrets, no unrelated changes.

---

## 9. Licensing and credit

Damlnaut is released under the [MIT License](LICENSE). By opening a pull request you
confirm that you wrote the work (or have the right to share it) and that it may be
released under the same MIT License.

Credit any source material in the PR and in the level's header comment. If you reuse
code or text from another project, keep that project's copyright and license notice
for those parts.
