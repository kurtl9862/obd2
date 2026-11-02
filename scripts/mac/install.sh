#!/bin/bash
# One-time setup for the OBD2 app on a Mac. Paste this into Terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/kurtl9862/obd2/main/scripts/mac/install.sh | bash
#
# It finds (or downloads) the OBD2 folder, checks for Node, and puts an "OBD2" app in your
# Applications folder. After that, double-click OBD2 instead of typing commands: it updates
# itself from GitHub, rebuilds when needed, starts the helper and opens Chrome.
# Running this again is safe; it just refreshes the app.

# Wrapped in main() so all of it is read before anything runs (safe with curl | bash).
main() {
set -euo pipefail

REPO_URL="https://github.com/kurtl9862/obd2.git"
APP="$HOME/Applications/OBD2.app"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || die "This installer is for macOS."

# --- git (comes with Apple's command line tools) ---
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1 || true
  die "macOS needs its free developer tools first. Click Install in the window that just opened, wait for it to finish, then paste the install command again."
fi

# --- Node 22.18 or newer ---
for dir in /opt/homebrew/bin /usr/local/bin; do
  case ":$PATH:" in *":$dir:"*) ;; *) [ -d "$dir" ] && PATH="$dir:$PATH" ;; esac
done
node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'
}
if ! node_ok; then
  if command -v brew >/dev/null 2>&1; then
    say "Installing Node with Homebrew…"
    brew install node || brew upgrade node
  fi
  node_ok || die "Node 22.18 or newer is needed. Download the macOS installer from https://nodejs.org (the LTS button), run it, then paste the install command again."
fi
NODE_DIR="$(dirname "$(command -v node)")"

# --- the OBD2 folder ---
is_repo() { [ -f "$1/bridge/bridge.ts" ] && [ -d "$1/.git" ]; }
REPO=""
if [ -n "${OBD2_DIR:-}" ]; then
  REPO="$OBD2_DIR"
elif [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ] && is_repo "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; then
  REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
else
  for d in "$HOME/obd2" "$HOME/Desktop/obd2" "$HOME/Documents/obd2" "$HOME/Downloads/obd2" \
           "$HOME/Developer/obd2" "$HOME/Projects/obd2" "$HOME/projects/obd2" "$HOME/code/obd2" \
           "$HOME/Code/obd2" "$HOME/GitHub/obd2" "$HOME/Documents/GitHub/obd2" "$HOME/src/obd2"; do
    if is_repo "$d"; then REPO="$d"; break; fi
  done
fi
if [ -z "$REPO" ]; then
  REPO="$HOME/obd2"
  say "Downloading OBD2 into $REPO…"
  git clone "$REPO_URL" "$REPO"
fi
is_repo "$REPO" || die "$REPO doesn't look like the OBD2 folder."
say "Using the OBD2 folder at $REPO"

# The app keeps itself on main (the merged, finished version).
cd "$REPO"
if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  if [ -z "$(git status --porcelain --untracked-files=no)" ]; then
    git fetch --quiet origin main || true
    git checkout --quiet main
  else
    echo "Note: the folder has unsaved edits on another branch, so the app won't update it automatically."
  fi
fi
git pull --quiet --ff-only origin main || echo "Note: couldn't update from GitHub right now; the app will try each time it opens."

# --- the app ---
say "Creating $APP…"
mkdir -p "$HOME/Applications"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

{
  echo '#!/bin/bash'
  echo '# Made by scripts/mac/install.sh. The real work is in launch.sh, which updates with the code.'
  printf 'export PATH=%q\n' "$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  printf 'exec /bin/bash %q "$@"\n' "$REPO/scripts/mac/launch.sh"
} >"$APP/Contents/MacOS/OBD2"
chmod +x "$APP/Contents/MacOS/OBD2"

cat >"$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>OBD2</string>
  <key>CFBundleDisplayName</key><string>OBD2</string>
  <key>CFBundleIdentifier</key><string>com.github.kurtl9862.obd2</string>
  <key>CFBundleExecutable</key><string>OBD2</string>
  <key>CFBundleIconFile</key><string>OBD2</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# Icon: turn scripts/mac/icon.png into the .icns macOS wants.
ICON_SRC="$REPO/scripts/mac/icon.png"
if [ -f "$ICON_SRC" ] && command -v iconutil >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  set="$tmp/OBD2.iconset"
  mkdir -p "$set"
  for size in 16 32 128 256 512; do
    sips -z $size $size "$ICON_SRC" --out "$set/icon_${size}x${size}.png" >/dev/null
    sips -z $((size * 2)) $((size * 2)) "$ICON_SRC" --out "$set/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$set" -o "$APP/Contents/Resources/OBD2.icns" || true
  rm -rf "$tmp"
fi
touch "$APP"

# --- first run: installs packages and builds, so the next double-click is quick ---
say "Getting it ready (the first time takes a minute or two)…"
if ! "$APP/Contents/MacOS/OBD2"; then
  tail -n 30 "$HOME/Library/Logs/OBD2/obd2.log" || true
  die "Something went wrong getting it ready. The lines above (and ~/Library/Logs/OBD2/obd2.log) say what."
fi

open -R "$APP" || true
say "Done. OBD2 is in your Applications folder (Finder just showed it) and should now be open in Chrome."
echo "From now on, just open OBD2: double-click it, find it with Spotlight (Cmd+Space, type OBD2),"
echo "or drag it from the Finder window onto your Dock. No Terminal needed."
}

main "$@" </dev/null
