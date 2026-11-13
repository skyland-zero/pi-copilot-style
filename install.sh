#!/usr/bin/env bash
# Install pi-copilot-style into the pi agent directory.
set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
agent_dir="${PI_AGENT_DIR:-$HOME/.pi/agent}"
dest="$agent_dir/extensions/pi-copilot-style"

mkdir -p "$dest" "$agent_dir/themes"
cp "$src"/*.ts "$src/package.json" "$src/README.md" "$dest"/
cp "$src"/themes/*.json "$agent_dir/themes/"

cat <<EOF
installed  $dest
themes     $agent_dir/themes/copilot-{dark,light}.json

next:
  1. restart pi (or run /reload)
  2. /copilot-style theme      # pick light/dark from the terminal appearance
  3. /copilot-style preview    # sample rows, esc to close
EOF
