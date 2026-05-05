#!/usr/bin/env bash
# Run locally if `git init` fails in a restricted environment (e.g. sandboxed agents).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -d .git ]]; then
  echo ".git already exists — aborting."
  exit 1
fi
git init -b main
git add -A
git status
read -r -p "Commit with message 'Initial commit: Staffing Health dashboard'? [y/N] " ans
if [[ "${ans,,}" == "y" ]]; then
  git commit -m "Initial commit: Staffing Health dashboard"
  echo "Done. Branch: $(git branch --show-current)"
else
  echo "Staged files only; no commit."
fi
