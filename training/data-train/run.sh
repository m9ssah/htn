#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cp ../content-model/dataset.jsonl ./dataset.jsonl

truss train push config.py --team "Hack the North"
