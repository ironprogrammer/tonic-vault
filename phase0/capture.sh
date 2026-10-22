#!/bin/sh
# Record from the default macOS input until a Tonic transfer finishes (or the time limit), then decode it.
# Usage: phase0/capture.sh <name> [max seconds, default 90]
set -e
[ -n "$1" ] || { echo "usage: $0 <name> [seconds]" >&2; exit 2; }
dir=$(cd "$(dirname "$0")" && pwd)
out="$dir/captures/$1"
mkdir -p "$out"
make -s -C "$dir"
echo "recording up to ${2:-90}s… start the transfer on the tonic now"
rec -q -c 1 -r 48000 -t f32 - trim 0 "${2:-90}" 2>/dev/null | tee "$out/capture.f32" | "$dir/build/diag" 48000 > "$out/diag.txt" || true
sox -t f32 -r 48000 -c 1 "$out/capture.f32" -b 16 "$out/capture.wav" 2>/dev/null
rm "$out/capture.f32"
tail -1 "$out/diag.txt"
sox "$out/capture.wav" -n stat 2>&1 | grep -E 'Maximum amplitude|RMS +amplitude'
"$dir/build/po32_decode_capture" "$out/capture.wav" "$out/decoded"
cat "$out/decoded/summary.txt"
