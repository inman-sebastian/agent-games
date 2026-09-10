#!/bin/bash
# shot.sh 'QUERY' [out.png] [page] — capture a game page to a tight PNG via headless Chrome
# (no MCP, no Playwright). Window size is derived from the query's w,h,scale so the PNG is
# exactly the rendered crop. `page` (relative to the game dir) defaults to tools/render.html;
# pass another page to shoot the style lab or the light lab, etc. Since the Vite migration the
# pages are ES modules, so point at a running dev server via SHOT_BASE (start `pnpm dev`);
# without SHOT_BASE it falls back to file:// (only works for pre-Vite static pages). Examples:
#   SHOT_BASE=http://localhost:5199 tools/shot.sh 'c=41&r=100&w=16&h=12&scale=3&cave=shaft'
#   SHOT_BASE=http://localhost:5199 tools/shot.sh 'w=40&h=24&scale=2' /tmp/lights.png tools/light-lab.html
set -e
q="${1:?usage: shot.sh 'QUERY' [out.png] [page]}"
out="${2:-/tmp/delve-shot.png}"
page="${3:-tools/render.html}"
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
if [ -n "$SHOT_BASE" ]; then url="$SHOT_BASE/$page?$q"; else url="file://$dir/$page?$q"; fi
# Plain load-then-capture (NO --virtual-time-budget). The budget hangs forever on continuously
# animating pages (the game, the light lab): a busy requestAnimationFrame loop never lets virtual
# time go idle, so Chrome never reaches the budget and never writes the file. Capturing at the
# `load` event works for those AND for the finite render harness — a `<script type=module>` finishes
# executing (so render.ts has drawn) before `load` fires. Stock macOS has no `timeout`, so we
# background Chrome and hard-kill it after WATCHDOG seconds as a safety net. Override WATCHDOG=<s>.
WATCHDOG="${WATCHDOG:-15}"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --no-first-run --no-default-browser-check \
  --screenshot="$out" --window-size="$ww,$wh" "$url" 2>/dev/null &
cpid=$!
( sleep "$WATCHDOG"; kill "$cpid" 2>/dev/null ) & wpid=$!
wait "$cpid" 2>/dev/null || true          # killed watchdog exit is fine; the file is already written
kill "$wpid" 2>/dev/null || true          # cancel the watchdog if Chrome exited on its own
echo "$out ($url  ${ww}x${wh})"
