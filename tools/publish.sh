#!/bin/bash
# Pubblica docs/data/meta.json su GitHub Pages: solo quel file, solo da main.
set -euo pipefail
cd "$(dirname "$0")/.."
branch=$(git branch --show-current)
if [ "$branch" != "main" ]; then
  echo "pubblicazione: la cartella è sul branch '$branch', non su main: non pubblico"
  exit 4
fi
if git diff --quiet -- docs/data/meta.json && git diff --cached --quiet -- docs/data/meta.json; then
  echo "pubblicazione: nessuna novità"
  exit 0
fi
# solo meta.json, anche se nella cartella c'è altro in stage
git commit -q -m "dati Meta al ${1:-$(date +%F)}" -- docs/data/meta.json
git pull -q --rebase --autostash origin main
git push -q origin main
echo "pubblicazione: ok ($(git rev-parse --short HEAD))"
