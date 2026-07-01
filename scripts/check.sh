#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
./damlw test
printf '\nLevel 0 demo flag:\nflag{daml_local_mvp_ready}\n'
