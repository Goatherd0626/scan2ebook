#!/bin/sh
set -eu
engine_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
engine_output=${1:-/tmp/scan2ebook-engine}
engine_cache=${TMPDIR:-/tmp}/scan2ebook-swift-module-cache
mkdir -p "$(dirname "$engine_output")"
xcrun swiftc -parse-as-library -O -whole-module-optimization \
  -module-cache-path "$engine_cache" -target arm64-apple-macosx13.0 \
  "$engine_dir"/*.swift -o "$engine_output"
