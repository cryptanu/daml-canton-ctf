# Daml Canton CTF

A beginner-friendly Daml/Canton security CTF inspired by Ethernaut-style levels, starting with a local-only MVP.

Level 0 is intentionally simple: it verifies that a player can run a Daml Script, create a challenge instance, submit the instance, and receive a `Flag` contract.

## Current Level

### Level 0: Local Submit

Objective:

```text
Run the local solution script and mint a Flag.
```

There is no wallet setup for Level 0. In Daml, the local MVP identity is a `Party` allocated by Daml Script.

The script:

1. Allocates a player party.
2. Creates a `Level0Instance`.
3. Exercises `SubmitLevel0`.
4. Receives a `Flag` contract.
5. Asserts that the expected flag value was created.

## Requirements

- Daml SDK `3.4.10` or compatible.
- Java runtime supported by the Daml SDK.

This repo includes a small `./damlw` wrapper that uses the installed `daml` binary and prefers Homebrew OpenJDK 17 when available.

## Run

```sh
./damlw test
```

Expected result:

```text
Solution:solveLevel0: ok
```

## Files

```text
daml/Damlnaut/Level0.daml  # challenge templates
daml/Solution.daml         # local MVP submit script
daml.yaml                  # Daml package config
scripts/check.sh           # convenience test runner
```

## Design Notes

This project starts without hosted infrastructure on purpose.

For the local MVP:

- A player is a Daml `Party`.
- Submission is a Daml Script transaction sequence.
- Completion is proven by creating a `Flag` contract.
- No real Canton wallet, validator, or web scoreboard is required.

Later levels can add an Ethernaut-like registry flow:

```text
Create Instance -> Exploit Instance -> Submit Instance -> Judge Creates Flag
```
