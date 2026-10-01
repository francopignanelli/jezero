#!/usr/bin/env bash
# Runs a pipeline step inside the GDAL container with the repository mounted at /work.
# Usage: scripts/geospatial/run.sh <inspect|operational|imagery|terrain|all|test>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then
  repo="$(cygpath -m "$repo")"
  here="$(cygpath -m "$here")"
fi
export MSYS_NO_PATHCONV=1

docker build -q -t copernico-geo "$here" >/dev/null
if [ "${1:-}" = "test" ]; then
  exec docker run --rm -v "$repo:/work" --entrypoint python3 copernico-geo -m pytest -q tests
fi
exec docker run --rm -v "$repo:/work" copernico-geo "$@"
