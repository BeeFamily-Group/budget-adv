"""Recupera i risultati delle chiamate Meta della routine dalle trascrizioni di Claude Code e li scrive in raw/.

Nessun numero passa a mano: o arriva da un risultato di ads_get_ad_entities con i parametri del piano,
oppure per quell'account si scrive <account>_error.txt e la dashboard tiene i dati del giorno prima.
"""
import argparse
import glob
import json
import os
import time

MATCH_KEYS = ("ad_account_id", "level", "time_range", "time_increment", "fields", "filtering")


def transcripts(since_hours):
    base = os.path.expanduser("~/.claude/projects")
    lim = time.time() - since_hours * 3600
    out = [f for f in glob.glob(os.path.join(base, "**", "*.jsonl"), recursive=True) if os.path.getmtime(f) >= lim]
    return sorted(out, key=os.path.getmtime)


def _norm(v):
    if isinstance(v, str) and v.strip()[:1] in "[{":
        try:
            v = json.loads(v)
        except ValueError:
            pass
    return json.dumps(v, sort_keys=True) if v not in (None, "") else None


def _result_text(block):
    c = block.get("content")
    if isinstance(c, list):
        c = "".join(x.get("text", "") for x in c if isinstance(x, dict))
    c = c or ""
    if c.lstrip().startswith("{"):
        return c
    for tok in c.split():  # risultato grande salvato dall'harness in tool-results/
        t = tok.strip("`'\".,:;()[]")
        if t.endswith((".txt", ".json")) and os.path.exists(t):
            return open(t, encoding="utf-8").read()
    return c


def _parse(text):
    """(righe, errore). Righe = lista di entita' o None."""
    try:
        d = json.loads(text)
    except (TypeError, ValueError):
        return None, (text or "risultato non leggibile")[:300]
    if not isinstance(d, dict):
        return None, "risultato inatteso"
    if d.get("error"):
        return None, str(d["error"])[:300]
    ents = d.get("ad_entities")
    if isinstance(ents, str):
        try:
            ents = json.loads(ents)
        except ValueError:
            return None, "ad_entities non leggibile"
    if not isinstance(ents, list):
        return None, "nessuna lista ad_entities"
    return ents, None


def harvest(plan, paths, raw_dir):
    wanted = {c["key"]: {k: _norm(c["args"].get(k)) for k in MATCH_KEYS} for c in plan["calls"]}
    rows = {}
    errors = {}
    for path in paths:
        uses = {}
        for line in open(path, encoding="utf-8", errors="ignore"):
            if '"tool_use"' not in line and '"tool_result"' not in line:
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            content = (o.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use" and b.get("name", "").endswith("ads_get_ad_entities"):
                    inp = b.get("input") or {}
                    sig = {k: _norm(inp.get(k)) for k in MATCH_KEYS}
                    for key, w in wanted.items():
                        if sig == w:
                            uses[b["id"]] = key
                elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses:
                    key = uses[b["tool_use_id"]]
                    ents, err = _parse(_result_text(b))
                    if err:
                        errors[key] = err
                    else:
                        errors.pop(key, None)
                        rows.setdefault(key, {})
                        for e in ents:  # pagine e ripetizioni: vince l'ultima riga con la stessa chiave
                            rows[key][(str(e.get("id")), e.get("date_start"))] = e
    os.makedirs(raw_dir, exist_ok=True)
    accounts = sorted({c["args"]["ad_account_id"] for c in plan["calls"]})
    ok, failed = [], []
    for acc in accounts:
        keys = [c["key"] for c in plan["calls"] if c["args"]["ad_account_id"] == acc]
        missing = [k for k in keys if k not in rows]
        if missing:
            msg = "; ".join(errors.get(k, "chiamata mancante: " + k) for k in missing)
            with open(os.path.join(raw_dir, acc + "_error.txt"), "w") as f:
                f.write(msg)
            failed.append(acc)
            continue
        for k in keys:
            with open(os.path.join(raw_dir, k + ".json"), "w") as f:
                json.dump(list(rows[k].values()), f, ensure_ascii=False)
        ok.append(acc)
    return {"ok": ok, "failed": failed}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", default="raw/plan.json")
    ap.add_argument("--raw", default="raw")
    ap.add_argument("--since-hours", type=float, default=6)
    a = ap.parse_args()
    plan = json.load(open(a.plan))
    print(json.dumps(harvest(plan, transcripts(a.since_hours), a.raw)))


if __name__ == "__main__":
    main()
