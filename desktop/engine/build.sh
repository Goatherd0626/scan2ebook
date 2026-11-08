#!/bin/sh
set -eu
engine_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
engine_output=${1:-/tmp/scan2ebook-engine}
engine_arch=${2:-$(node -p 'process.arch')}
node "$engine_dir/../../reader/scripts/build-native-engine.mjs" --arch "$engine_arch"
mkdir -p "$(dirname "$engine_output")"
cp -p "$engine_dir/../../reader/native/darwin-$engine_arch/scan2ebook-engine" "$engine_output"
