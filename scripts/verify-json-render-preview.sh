#!/usr/bin/env sh
set -eu

archive="vendor/json-render-core-0.21.0-3ad3818-preview3.tgz"
expected="3e7d2d2ac3176d5aa1afe259ca53f777a3c277fbbe867cf2c9a7e37ab97596b4"
actual=$(shasum -a 256 "$archive" | awk '{print $1}')

test "$actual" = "$expected"
printf '%s verified\n' "$archive"
