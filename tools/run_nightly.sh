#!/bin/bash
# Parte deterministica della routine notturna, da lanciare DOPO le chiamate Meta del piano.
#   tools/run_nightly.sh plan     -> raw/plan.json (svuota raw/)
#   tools/run_nightly.sh finish   -> harvest, meta.json, mappa, speso nello Sheet, pubblicazione
set -euo pipefail
cd "$(dirname "$0")/.."
PY="python3 -I"
ROSTER="$HOME/Desktop/CLAUDE CODE/BEEFAMILY/DOWNLOAD FATTURE/_automation/roster_beefamily.json"

case "${1:-}" in
  plan)
    rm -rf raw && mkdir -p raw
    $PY tools/routine_api.py state > raw/state_plan.json 2>/dev/null || rm -f raw/state_plan.json
    $PY tools/meta_plan.py --roster "$ROSTER" --out raw/plan.json --state raw/state_plan.json > /dev/null
    $PY -c "import json;p=json.load(open('raw/plan.json'));print('chiamate:',len(p['calls']),'| periodo',p['since'],'→',p['until'])"
    ;;
  finish)
    H=$($PY tools/harvest_meta.py --plan raw/plan.json --raw raw --since-hours 6)
    echo "harvest: $H"
    if $PY -c "import json,sys;sys.exit(0 if json.loads(sys.argv[1])['ok'] else 1)" "$H"; then :; else
      echo "NESSUN account letto: non pubblico nulla, la dashboard resta ai dati di ieri"; exit 3
    fi
    $PY tools/routine_api.py state > raw/state.json
    AS_OF=$($PY -c "import json;print(json.load(open('raw/plan.json'))['as_of'])")
    $PY tools/build_meta.py --raw raw --prev docs/data/meta.json --out docs/data/meta.json \
      --state raw/state.json --roster "$ROSTER" --as-of "$AS_OF" --mapping-out raw/mapping_new.json
    echo "mappa: $($PY tools/routine_api.py post upsertMapping @raw/mapping_new.json)"
    echo "speso nello Sheet: $($PY tools/routine_api.py spend docs/data/meta.json)"
    tools/publish.sh "$AS_OF"
    ;;
  *) echo "uso: $0 plan|finish"; exit 2 ;;
esac
