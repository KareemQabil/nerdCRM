#!/usr/bin/env bash
# The Railway image fetches Axelor at the commits in its Dockerfile; they must equal the repository's pins.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKERFILE="$ROOT/deploy/railway/Dockerfile"
webapp="$(git -C "$ROOT" ls-tree HEAD axelor-app | awk '{print $3}')"
aos="$(git -C "$ROOT/axelor-app" ls-tree HEAD modules/axelor-open-suite | awk '{print $3}')"
grep -q "^ARG WEBAPP_SHA=$webapp$" "$DOCKERFILE" || { echo "FAIL: Dockerfile WEBAPP_SHA differs from the axelor-app pin $webapp" >&2; exit 1; }
grep -q "^ARG AOS_SHA=$aos$" "$DOCKERFILE" || { echo "FAIL: Dockerfile AOS_SHA differs from the axelor-open-suite pin $aos" >&2; exit 1; }
echo "PASS pins match: open-suite-webapp $webapp, axelor-open-suite $aos"
