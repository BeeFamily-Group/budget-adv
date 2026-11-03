#!/bin/bash
# Pubblica docs/data/meta.json su GitHub Pages (solo quel file).
set -euo pipefail
cd "$(dirname "$0")/.."
git add docs/data/meta.json
if git diff --cached --quiet; then
  echo "pubblicazione: nessuna novità"
  exit 0
fi
git commit -q -m "dati Meta al ${1:-$(date +%F)}"
git push -q origin main
echo "pubblicazione: ok ($(git rev-parse --short HEAD))"
