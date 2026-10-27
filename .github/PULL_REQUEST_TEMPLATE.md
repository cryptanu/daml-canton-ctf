## Summary

<!-- Imperative title above, e.g. "Add Level 2: Authorization Replay". One sentence on what this PR does. -->

## What the level teaches

<!-- One sentence a player could repeat. Difficulty: warm-up / easy / medium / hard. -->

## Bug class and source

<!-- The flaw, and where the pattern comes from (audit, curriculum section, your own find). Credit sources. -->

## How to win

<!-- One paragraph. The full solution belongs in daml/SolutionLevelN.daml, not here (the repo is public). -->

## Control case

<!-- A plausible wrong attempt and what it produces (a non-winning proof). -->

## The fix

<!-- The change that closes the bug. -->

## Evidence

- [ ] `./damlw test` output pasted (win passes, controls do not win)
- [ ] Exploit shown working against a real ledger (script output or UI screenshot)
- [ ] Fix applied locally and the exploit then fails
- [ ] Control case result shown

## Checklist

- [ ] One level per PR; no unrelated changes
- [ ] `./damlw build` run and the rebuilt DAR is committed under `packages/`
- [ ] `npm run typecheck` and `npm run build` pass
- [ ] Every wallet command uses a unique command id (`nonce()`)
- [ ] Consuming choices handled in the UI; bootstrap endpoints idempotent
- [ ] `CHANGELOG.md` updated
- [ ] No secrets, `.env`, `dist/` or scratch files committed
- [ ] Level text matches its difficulty and does not give the answer away early

## Screenshots

<!-- The level in the UI. Include dark mode if you changed styles. -->
