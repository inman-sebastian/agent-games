#!/bin/bash
# shot.sh 'QUERY' [out.png] — capture tools/render.html?QUERY to a tight PNG via headless
# Chrome (no MCP). Window size is derived from the query's w,h,scale so the PNG is exactly
# the rendered crop. Example:
#   tools/shot.sh 'c=41&r=100&w=16&h=12&scale=3&cave=shaft'
#   tools/shot.sh 'r=380&w=12&h=10&scale=4&lamp=0' /tmp/basalt.png
set -e
q="${1:?usage: shot.sh 'QUERY' [out.png]}"
out="${2:-/tmp/delve-shot.png}"
getp() { echo "$q" | grep -oE "(^|&)$1=[0-9]+" | grep -oE '[0-9]+$' | tail -1; }
w=$(getp w); h=$(getp h); s=$(getp scale)
w=${w:-18}; h=${h:-14}; s=${s:-3}
ww=$((w * 16 * s)); wh=$((h * 16 * s))
dir="$(cd "$(dirname "$0")/.." && pwd)"
for CHROME in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  [ -x "$CHROME" ] && break
done
TO=""   # optional watchdog (not present on stock macOS)
if command -v timeout >/dev/null 2>&1; then TO="timeout 30"; elif command -v gtimeout >/dev/null 2>&1; then TO="gtimeout 30"; fi
$TO "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --no-first-run --no-default-browser-check \
  --screenshot="$out" --window-size="$ww,$wh" "file://$dir/tools/render.html?$q" 2>/dev/null
echo "$out (${ww}x${wh})"
