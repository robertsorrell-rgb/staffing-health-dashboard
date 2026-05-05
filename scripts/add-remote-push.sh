#!/usr/bin/env bash
# Usage: bash scripts/add-remote-push.sh git@github.com:YOUR_ORG/staffing-health-dashboard.git
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "Usage: $0 <git-remote-url>"
  exit 1
fi
if git remote get-url origin &>/dev/null; then
  git remote set-url origin "$URL"
else
  git remote add origin "$URL"
fi
git push -u origin main
