#!/bin/sh
# Record one Tonic transfer from the default macOS input, then decode it.
# Recording starts on the first sound and stops after 2s of silence (Ctrl-C also stops it).
# Usage: phase0/capture.sh <name>
set -e
[ -n "$1" ] || { echo "usage: $0 <name>" >&2; exit 2; }
dir=$(cd "$(dirname "$0")" && pwd)
out="$dir/captures/$1"
mkdir -p "$out"
make -s -C "$dir"
echo "listening… now start the transfer on the tonic"
trap : INT
rec -q -c 1 -r 48000 -b 16 "$out/capture.wav" silence 1 0.05 1% 1 2.0 1% || true
trap - INT
soxi -D "$out/capture.wav" | xargs printf 'recorded %ss\n'
"$dir/build/po32_decode_capture" "$out/capture.wav" "$out/decoded"
cat "$out/decoded/summary.txt"
