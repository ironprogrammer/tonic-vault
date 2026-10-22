#!/bin/sh
# Record a fixed window from the default macOS input, then decode any Tonic transfer in it.
# Usage: phase0/capture.sh <name> [seconds, default 30]
set -e
[ -n "$1" ] || { echo "usage: $0 <name> [seconds]" >&2; exit 2; }
dir=$(cd "$(dirname "$0")" && pwd)
out="$dir/captures/$1"
mkdir -p "$out"
make -s -C "$dir"
echo "recording ${2:-30}s… start the transfer on the tonic now"
rec -q -c 1 -r 48000 -b 16 "$out/capture.wav" trim 0 "${2:-30}"
sox "$out/capture.wav" -n stat 2>&1 | grep -E 'Maximum amplitude|RMS +amplitude'
"$dir/build/po32_decode_capture" "$out/capture.wav" "$out/decoded"
cat "$out/decoded/summary.txt"
