"""TikTok Ads nella routine notturna (19/11/2026): speso e clic del mese per la card "Color Holiday" (TikTok Ads).

Come per Meta, nessun numero passa a mano: il piano della notte (raw/plan.json, "windsor_calls") dice quale lettura
Windsor.ai fare; la routine la esegue con lo strumento get_data e questo script ne recupera il risultato dalle
trascrizioni di Claude Code, poi manda alla web app l'azione saveTiktok (tab TIKTOK + Spesa Effettiva del mese).
Periodo come Meta e ChatGPT: dal primo del mese a ieri; il primo del mese chiude il mese prima.
I clic vanno in leads_mtd: la dashboard li mostra come clic, non come lead. Il budget giornaliero Windsor non lo dà.
"""
import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import harvest_meta  # noqa: E402

# Un blocco per riga: account TikTok Ads (come lo vede Windsor.ai) e blocco dello Sheet.
CHANNELS = [
    {"account": "7709484493702447105", "channel_id": "Color Holiday - TikTok ADS|A", "title": "BUDGET TIKTOK ADS"},
]
TITLES = {c["channel_id"]: c["title"] for c in CHANNELS}
FIELDS = ["date", "spend", "clicks", "impressions"]
MATCH = ("connector", "accounts", "fields", "date_from", "date_to")


def windsor_calls(today):
    until = today - datetime.timedelta(days=1)
    since = until.replace(day=1)
    return [{"key": "tiktok_" + c["account"], "channel_id": c["channel_id"], "args": {
        "connector": "tiktok", "accounts": [c["account"]], "fields": list(FIELDS),
        "date_from": since.isoformat(), "date_to": until.isoformat()}} for c in CHANNELS]


def _sig(args):
    return json.dumps({k: args.get(k) for k in MATCH}, sort_keys=True)


def _done_rows(text):
    """Righe di un get_data finito (status done), altrimenti None: pending, errore o testo non leggibile."""
    try:
        d = json.loads(text)
    except (TypeError, ValueError):
        return None
    if isinstance(d, dict) and isinstance(d.get("result"), dict):
        d = d["result"]
    if isinstance(d, dict) and d.get("status") == "done" and isinstance(d.get("data"), list):
        return d["data"]
    return None


def harvest(calls, paths, raw_dir):
    wanted = {_sig(c["args"]): c["key"] for c in calls}
    rows = {}
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
                if b.get("type") == "tool_use" and b.get("name", "").endswith("get_data"):
                    key = wanted.get(_sig(b.get("input") or {}))
                    if key:
                        uses[b["id"]] = key
                elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses:
                    data = _done_rows(harvest_meta._result_text(b))
                    if data is not None:
                        rows[uses[b["tool_use_id"]]] = data   # vince l'ultima lettura finita
    os.makedirs(raw_dir, exist_ok=True)
    ok, failed = [], []
    for c in calls:
        if c["key"] in rows:
            with open(os.path.join(raw_dir, c["key"] + ".json"), "w") as f:
                json.dump(rows[c["key"]], f, ensure_ascii=False)
            ok.append(c["key"])
        else:
            with open(os.path.join(raw_dir, c["key"] + "_error.txt"), "w") as f:
                f.write("lettura Windsor mancante o non finita")
            failed.append(c["key"])
    return {"ok": ok, "failed": failed}


def payload(call, rows):
    a = call["args"]
    inside = [r for r in rows if a["date_from"] <= str(r.get("date", ""))[:10] <= a["date_to"]]
    spend = round(sum(float(r.get("spend") or 0) for r in inside), 2)
    clicks = sum(int(float(r.get("clicks") or 0)) for r in inside)
    last_day = sum(float(r.get("spend") or 0) for r in inside if str(r.get("date", ""))[:10] == a["date_to"])
    return {"channel_id": call["channel_id"], "title": TITLES[call["channel_id"]], "date": a["date_to"],
            "spent_mtd": spend, "leads_mtd": clicks, "daily_budget": 0, "active": last_day > 0}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", default="raw/plan.json")
    ap.add_argument("--raw", default="raw")
    ap.add_argument("--since-hours", type=float, default=6)
    a = ap.parse_args()
    calls = json.load(open(a.plan)).get("windsor_calls", [])
    h = harvest(calls, harvest_meta.transcripts(a.since_hours), a.raw)
    import routine_api  # solo qui: i test non toccano la web app
    out = []
    for c in calls:
        if c["key"] in h["failed"]:
            out.append("%s: non letto (lettura Windsor mancante)" % c["channel_id"])
            continue
        p = payload(c, json.load(open(os.path.join(a.raw, c["key"] + ".json"))))
        r = routine_api.post("saveTiktok", p)
        out.append("%s: %.2f € · %d clic · %s" % (c["channel_id"], p["spent_mtd"], p["leads_mtd"], "ok" if r.get("ok") else "ERRORE " + str(r.get("error"))))
    print(" | ".join(out) or "nessuna lettura TikTok nel piano")


if __name__ == "__main__":
    main()
