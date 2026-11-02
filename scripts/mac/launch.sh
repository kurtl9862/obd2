#!/bin/bash
# What the OBD2 app does when you double-click it:
#   1. gets the latest version from GitHub (skipped quietly if there's no internet),
#   2. installs packages and rebuilds the web app only when something changed,
#   3. starts the Mac helper in the background (or restarts it after an update),
#   4. opens http://localhost:35001 in Chrome.
#
# Usage: launch.sh [--sim] [--stop] [--no-open]
# Everything is wrapped in main() so bash reads the whole file before running it;
# that way a git pull that changes this file can't trip up the copy that's running.

main() {
  set -u
  local repo port url support logdir log pidfile stamp
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  port="${OBD_BRIDGE_PORT:-35001}"
  url="http://localhost:$port"
  support="$HOME/Library/Application Support/OBD2"
  logdir="$HOME/Library/Logs/OBD2"
  log="$logdir/obd2.log"
  pidfile="$support/bridge.pid"
  stamp="$support/running-commit"
  mkdir -p "$support" "$logdir"

  local sim=0 stop=0 open_browser=1 arg
  for arg in "$@"; do
    case "$arg" in
      --sim) sim=1 ;;
      --stop) stop=1 ;;
      --no-open) open_browser=0 ;;
    esac
  done

  # Keep the log from growing forever.
  if [ -f "$log" ] && [ "$(wc -c <"$log")" -gt 2000000 ]; then
    mv -f "$log" "$log.old"
  fi
  exec >>"$log" 2>&1
  echo
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') launch $* ==="

  cd "$repo" || { fail "Can't find the OBD2 folder at $repo."; return 1; }

  if [ "$stop" = 1 ]; then
    stop_bridge
    notify "OBD2 stopped."
    return 0
  fi

  # 1. Update from GitHub, only when it's safe to: on main, with no edits of your own.
  local before after branch
  before="$(git rev-parse HEAD 2>/dev/null || echo none)"
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  if [ "$branch" != "main" ]; then
    echo "on branch $branch, not main: skipping update"
  elif [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    echo "local changes present: skipping update"
  else
    echo "checking GitHub for updates"
    # Give up after ~15 s of no progress, e.g. when the Mac is on the adapter's Wi-Fi without internet.
    if GIT_TERMINAL_PROMPT=0 GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=15 \
        git fetch --quiet origin main; then
      git merge --ff-only --quiet origin/main || echo "could not fast-forward to origin/main"
    else
      echo "no internet or GitHub unreachable: using the version already here"
    fi
  fi
  after="$(git rev-parse HEAD 2>/dev/null || echo none)"
  [ "$before" != "$after" ] && echo "updated $before -> $after"

  # 2. Packages, only when package.json changed (or they were never installed).
  local pkgsum
  pkgsum="$(cat package.json web/package.json | shasum | cut -d' ' -f1)"
  if [ ! -d node_modules ] || [ ! -d web/node_modules ] || [ "$(cat "$support/packages" 2>/dev/null)" != "$pkgsum" ]; then
    notify "Installing packages (first time or after an update)…"
    if npm run setup; then
      echo "$pkgsum" >"$support/packages"
    else
      fail "Installing packages failed."
      return 1
    fi
  fi

  # Build, only when the code changed since the last build.
  if [ ! -f web/dist/index.html ] || [ "$(cat "$support/built-commit" 2>/dev/null)" != "$after" ]; then
    notify "Building the app…"
    if npm run build; then
      echo "$after" >"$support/built-commit"
    else
      fail "Building the app failed."
      return 1
    fi
  fi

  # 3. The helper: reuse it if it's running this version in the same mode, otherwise (re)start it.
  local want="$after sim=$sim"
  if healthy && [ "$(cat "$stamp" 2>/dev/null)" = "$want" ]; then
    echo "helper already running"
  else
    stop_bridge
    local args=()
    [ "$sim" = 1 ] && args+=(--sim)
    echo "starting helper ${args[*]:-}"
    nohup node bridge/bridge.ts ${args[@]+"${args[@]}"} >>"$log" 2>&1 </dev/null &
    echo $! >"$pidfile"
    disown 2>/dev/null || true
    local i
    for i in $(seq 1 40); do
      healthy && break
      sleep 0.25
    done
    if ! healthy; then
      fail "The helper didn't start."
      return 1
    fi
    echo "$want" >"$stamp"
  fi

  # 4. Open the app.
  if [ "$open_browser" = 1 ]; then
    open_app "$url"
  fi
  echo "ready at $url"
}

healthy() {
  curl -fs --max-time 1 "http://127.0.0.1:${OBD_BRIDGE_PORT:-35001}/health" >/dev/null 2>&1
}

stop_bridge() {
  local pid pidfile="$HOME/Library/Application Support/OBD2/bridge.pid"
  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile")"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null && echo "stopped helper $pid"
    rm -f "$pidfile"
  fi
  # A helper started by hand with "npm start" also holds the port.
  if command -v lsof >/dev/null 2>&1; then
    for pid in $(lsof -ti "tcp:${OBD_BRIDGE_PORT:-35001}" -sTCP:LISTEN 2>/dev/null); do
      kill "$pid" 2>/dev/null && echo "stopped process $pid on the helper's port"
    done
  fi
  local i
  for i in $(seq 1 20); do
    healthy || break
    sleep 0.25
  done
  rm -f "$HOME/Library/Application Support/OBD2/running-commit"
}

open_app() {
  local browser
  for browser in "Google Chrome" "Microsoft Edge" "Chromium"; do
    if open -Ra "$browser" 2>/dev/null; then
      open -a "$browser" "$1"
      return
    fi
  done
  open "$1"
}

notify() {
  echo "$1"
  command -v osascript >/dev/null 2>&1 || return 0
  osascript -e "display notification \"$1\" with title \"OBD2\"" >/dev/null 2>&1 || true
}

fail() {
  echo "ERROR: $1"
  command -v osascript >/dev/null 2>&1 || return 0
  local choice
  choice="$(osascript -e "button returned of (display dialog \"$1\" & return & return & \"The log has the details.\" with title \"OBD2\" buttons {\"Show log\", \"OK\"} default button \"OK\" with icon caution)" 2>/dev/null)"
  [ "$choice" = "Show log" ] && open -e "$HOME/Library/Logs/OBD2/obd2.log"
}

main "$@"
