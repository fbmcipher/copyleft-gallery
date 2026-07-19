#!/usr/bin/env bash
# copyleft.gallery — install, build, seed (first run), and serve. LOCAL ONLY.
# v0.2 is a private iteration: no public tunnel (see SPEC v0.2 §5).
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3017}"

if [ ! -f .env ]; then
  echo "⚠ No .env found — copying .env.example. Fill in NEURALWATT_API_KEY before querying."
  cp .env.example .env
fi

echo "▸ Installing dependencies…"
npm install --no-fund --no-audit

echo "▸ Building frontend…"
npm run build

if [ -z "$(ls data/curations/*.json 2>/dev/null || true)" ]; then
  echo "▸ First run — seeding exhibitions (needs NEURALWATT_API_KEY; takes a few minutes)…"
  node scripts/seed.js || echo "⚠ Seeding failed — homepage preview wall will be empty until you run: node scripts/seed.js"
fi

echo "▸ Starting server…"
echo
echo "──────────────────────────────────────────────"
echo "  copyleft.gallery — http://localhost:$PORT"
echo "  (private/local — not exposed publicly)"
echo "──────────────────────────────────────────────"
echo
PORT="$PORT" exec node server/index.js
