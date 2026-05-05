#!/usr/bin/env bash
# Use when plain `git init` fails with ".git/hooks: Operation not permitted" (some IDE sandboxes).
# Stores repo metadata beside the project; working tree stays in Staffing-Health-Dashboard/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GITSTORE="${GITSTORE:-$(dirname "$ROOT")/$(basename "$ROOT").repo.git}"
cd "$ROOT"
if [[ -f .git && ! -d .git ]]; then
  echo "Already using gitdir pointer (.git file). METADATA: $(cat .git | sed 's/gitdir: //')"
  exit 0
fi
if [[ -d .git ]]; then
  echo "Regular .git exists — remove or rename it before using this script."
  exit 1
fi
git init --separate-git-dir="$GITSTORE" -b main
echo "Initialized. Metadata: $GITSTORE"
echo "Working tree: $ROOT"
