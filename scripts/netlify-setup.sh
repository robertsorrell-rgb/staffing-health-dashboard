#!/usr/bin/env bash
# Link Netlify site, import env from .env, deploy (interactive login required once).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
CLI=(npx --yes netlify-cli)

if [[ ! -f .env ]]; then
  echo "Missing .env — run: node scripts/bootstrap-local-env.js /path/to/service-account.json"
  exit 1
fi

echo ">>> Netlify login (opens browser if needed)"
"${CLI[@]}" login

echo ">>> Link this folder to a Netlify site (create empty site in dashboard first if needed)"
if [[ ! -f .netlify/state.json ]]; then
  "${CLI[@]}" link
else
  echo "(already linked — skip link or run: rm -rf .netlify && netlify link)"
fi

echo ">>> Import environment variables from .env into Netlify (merge with existing)"
"${CLI[@]}" env:import .env

echo ">>> Deploy draft (preview URL)"
"${CLI[@]}" deploy --build

echo ""
echo "When satisfied: ${CLI[*]} deploy --prod --build"
