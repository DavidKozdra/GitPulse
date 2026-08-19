#!/usr/bin/env bash
# Build Chrome/Edge and Firefox packages. Linux/macOS counterpart to pack.ps1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src"
DIST="$ROOT/dist"
VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/manifest.json'))['version'])")"

# Shippable files only. Everything else under src/ (node_modules, tests,
# coverage, dotfiles) must NOT be packaged: MV3 stores reject bundled
# remotely-hosted code, and dev deps contain references to remote URLs.
INCLUDE=(
  background.js compat.js config.js main.js emoji.js
  popup.html popup.js style.css
  icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png
  content/main.helpers.js content/main.banner.js content/main.links.js
  content/main.detect.js content/main.bootstrap.js
)
# Chrome/Edge manifest still points at the legacy flat icon.
EDGE_EXTRA=(icon.png)

stage() { # $1=target dir  $2...=relative files
  local dest="$1"; shift
  for rel in "$@"; do
    [[ -f "$SRC/$rel" ]] || { echo "Missing required file: src/$rel" >&2; exit 1; }
    mkdir -p "$dest/src/$(dirname "$rel")"
    cp -f "$SRC/$rel" "$dest/src/$rel"
  done
}

# Fail the build if remotely hosted executable code or MV3-incompatible
# dynamic-code constructs ever enter a package.
scan() {
  local dir="$1" name pattern hits
  while IFS='|' read -r name pattern; do
    hits="$(grep -rInE "$pattern" --include='*.js' --include='*.mjs' \
      --include='*.html' --include='*.css' "$dir" || true)"
    if [[ -n "$hits" ]]; then
      echo "MV3 validation failed ($name):" >&2; echo "$hits" >&2; exit 1
    fi
  done <<'PATTERNS'
remote script tag|<script[^>]+src[[:space:]]*=[[:space:]]*["']https?://
remote module import|(from[[:space:]]*|import[[:space:]]*\()["']https?://
remote worker import|importScripts[[:space:]]*\([^)]*https?://
remote CSS resource|(@import|url[[:space:]]*\()[^;]*https?://
eval|\beval[[:space:]]*\(
Function constructor|\bnew[[:space:]]+Function[[:space:]]*\(
PATTERNS
}

rm -rf "$DIST"
mkdir -p "$DIST/edge" "$DIST/firefox"

# --- Chrome / Edge -----------------------------------------------------------
cp -f "$ROOT/manifest.json" "$DIST/edge/manifest.json"
stage "$DIST/edge" "${INCLUDE[@]}" "${EDGE_EXTRA[@]}"
scan "$DIST/edge"
python3 "$ROOT/scripts/zipdir.py" "$DIST/edge" "$DIST/GitPulse-$VERSION-edge.zip"

# --- Firefox -----------------------------------------------------------------
# Manifest paths are relative to the zip root, so src/ sits at the top level
# here too -- no nested wrapper directory.
python3 - "$ROOT/manifest.firefox.json" "$DIST/firefox/manifest.json" "$VERSION" <<'PY'
import json, sys
src, dst, version = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(src))
m["version"] = version
json.dump(m, open(dst, "w"), indent=2)
PY
stage "$DIST/firefox" "${INCLUDE[@]}"
scan "$DIST/firefox"
python3 "$ROOT/scripts/zipdir.py" "$DIST/firefox" "$DIST/GitPulse-$VERSION-firefox.zip"

echo "Created: $DIST/GitPulse-$VERSION-edge.zip"
echo "Created: $DIST/GitPulse-$VERSION-firefox.zip"
