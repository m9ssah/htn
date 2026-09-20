#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cp ../content-model/dataset.jsonl ./dataset.jsonl

truss train push config_a10g.py --team "Hack the North"
