"""Dati Meta per la dashboard: dai file raw della routine notturna a docs/data/meta.json.

raw/<account>_campaigns.json  campagne ACTIVE (id, name, effective_status, daily_budget)
raw/<account>_adsets.json     adset ACTIVE e non (id, campaign_id, effective_status, daily_budget)
raw/<account>_daily.json      righe giornaliere per campagna (date_start, amount_spent, lead, id, name)
raw/<account>_error.txt       se l'account non si e' letto
"""
import argparse
import datetime
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import accounts as accounts_mod  # noqa: E402

COLOR_HOTELS = {
    "perla village": "Color Perla Village", "palace": "Color Palace Lido", "palace lido": "Color Palace Lido",
    "bay": "Color Bay Village", "bay village": "Color Bay Village", "green village": "Color Green Village",
    "ermitage": "Color Ermitage", "metropolitan": "Color Metropolitan", "king marte": "Color King Marte",
    "alexandra plaza": "Color Alexandra Plaza", "mokambo": "Color Mokambo", "miami": "Color Miami",
    "dolmen": "Color Dolmen",
}


def _money(v):
    if isinstance(v, dict):
        v = v.get("value")
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def _load(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return json.load(f)


def _account_ids(raw_dir):
    ids = set()
    for p in glob.glob(os.path.join(raw_dir, "*_*.*")):
        base = os.path.basename(p)
        if base.endswith(("_campaigns.json", "_adsets.json", "_daily.json", "_error.txt")):
            ids.add(base.split("_")[0])
    return sorted(ids)


def _countries(targeting):
    """Paesi del target di un adset (geo_locations.countries), anche se l'MCP lo restituisce come testo JSON."""
    if isinstance(targeting, str):
        try:
            targeting = json.loads(targeting)
        except ValueError:
            return []
    if not isinstance(targeting, dict):
        return []
    return [str(c).upper() for c in ((targeting.get("geo_locations") or {}).get("countries") or [])]


def normalize(raw_dir):
    out = {"accounts": {}, "campaigns": [], "daily": []}
    for acc in _account_ids(raw_dir):
        err_path = os.path.join(raw_dir, acc + "_error.txt")
        if os.path.exists(err_path):
            with open(err_path) as f:
                out["accounts"][acc] = {"ok": False, "error": f.read().strip(), "last_ok": None}
            continue
        out["accounts"][acc] = {"ok": True, "error": None, "last_ok": None}
        adsets_by_campaign = {}
        countries_by_campaign = {}
        for s in _load(os.path.join(raw_dir, acc + "_adsets.json")):
            adsets_by_campaign.setdefault(str(s["campaign_id"]), []).append(
                {"id": str(s["id"]), "status": s.get("effective_status"), "daily_budget": _money(s.get("daily_budget"))})
            geo = _countries(s.get("targeting"))
            if geo:
                countries_by_campaign.setdefault(str(s["campaign_id"]), set()).update(geo)
        campaigns = {}
        for c in _load(os.path.join(raw_dir, acc + "_campaigns.json")):
            cid = str(c["id"])
            adsets = adsets_by_campaign.get(cid, [])
            camp_budget = _money(c.get("daily_budget"))
            if camp_budget is not None:
                level, budget = "campaign", camp_budget
            else:
                level = "adset"
                budget = round(sum(a["daily_budget"] or 0 for a in adsets if a["status"] == "ACTIVE"), 2)
            campaigns[cid] = {"id": cid, "account_id": acc, "name": c.get("name", ""), "status": c.get("effective_status"),
                              "daily_budget": budget, "budget_level": level, "adsets": adsets}
            if cid in countries_by_campaign:
                campaigns[cid]["countries"] = sorted(countries_by_campaign[cid])
        for r in _load(os.path.join(raw_dir, acc + "_daily.json")):
            if "id" not in r:  # Meta riempie i giorni senza spesa con righe vuote senza id
                continue
            cid = str(r["id"])
            if cid not in campaigns:
                campaigns[cid] = {"id": cid, "account_id": acc, "name": r.get("name", ""), "status": "NOT_ACTIVE",
                                  "daily_budget": 0, "budget_level": "campaign", "adsets": []}
            out["daily"].append({"campaign_id": cid, "date": r["date_start"],
                                 "spend": _money(r.get("amount_spent")) or 0.0, "leads": int(float(r.get("lead") or 0))})
        out["campaigns"].extend(campaigns.values())
    return out


def merge_with_previous(new, prev, as_of):
    prev = prev or {"accounts": {}, "campaigns": [], "daily": []}
    merged = {"as_of": as_of, "generated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
              "accounts": {}, "campaigns": list(new["campaigns"]), "daily": list(new["daily"])}
    for acc, st in new["accounts"].items():
        if st["ok"]:
            merged["accounts"][acc] = {"ok": True, "error": None, "last_ok": as_of}
            continue
        old = prev.get("accounts", {}).get(acc, {})
        merged["accounts"][acc] = {"ok": False, "error": st["error"], "last_ok": old.get("last_ok")}
        old_camps = [c for c in prev.get("campaigns", []) if c.get("account_id") == acc]
        old_ids = {c["id"] for c in old_camps}
        merged["campaigns"].extend(old_camps)
        merged["daily"].extend(r for r in prev.get("daily", []) if r["campaign_id"] in old_ids)
    return merged


def _channel_for(campaign, tab, meta_channels):
    if tab == "COLOR":
        prefix = campaign["name"].split(" - ")[0].strip().lower()
        hotel = COLOR_HOTELS.get(prefix)
        return hotel + "|A" if hotel and meta_channels.get(hotel) else ""
    letters = meta_channels.get(tab) or []
    if not letters:
        return ""
    countries = campaign.get("countries") or []
    abroad = "estero" in campaign["name"].lower() or (countries and "IT" not in countries)
    if len(letters) > 1 and abroad:
        return tab + "|" + letters[1]
    return tab + "|" + letters[0]


def auto_mapping(campaigns, accounts, existing, meta_channels, spend_ids, titles=None):
    """Righe nuove per il tab MAPPA. Solo campagne attive o con spesa; quelle gia' mappate non si toccano.
    Ogni riga porta il titolo del blocco (titles: {channel_id: titolo}), che la conferma se le colonne si spostano."""
    titles = titles or {}
    known = {str(r["campaign_id"]) for r in existing}
    rows = []
    for c in campaigns:
        cid = str(c["id"])
        if cid in known or not (c.get("status") == "ACTIVE" or cid in spend_ids):
            continue
        tab = accounts.get(str(c["account_id"]))
        ch = _channel_for(c, tab, meta_channels) if tab else ""
        rows.append({"account_id": str(c["account_id"]), "campaign_id": cid, "campaign_name": c["name"],
                     "channel_id": ch, "channel_title": titles.get(ch, "")})
        known.add(cid)
    return rows


def label_accounts(merged, accounts):
    """Ogni account dice a quale struttura appartiene (dal roster): serve all'avviso "dati fermi" della pagina."""
    for acc, info in merged["accounts"].items():
        info["tab"] = accounts.get(str(acc), "")
    return merged


def title_backfill(existing, titles):
    """Righe MAPPA gia' assegnate ma senza titolo del blocco: ricevono il titolo di oggi (una volta sola)."""
    return [{"account_id": str(r["account_id"]), "campaign_id": str(r["campaign_id"]), "campaign_name": r.get("campaign_name", ""),
             "channel_id": r["channel_id"], "channel_title": titles[r["channel_id"]]}
            for r in existing if r.get("channel_id") in titles and not r.get("channel_title")]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--prev", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--state", required=True, help="stato della web app (GET ?action=state)")
    ap.add_argument("--roster", required=True)
    ap.add_argument("--as-of", required=True)
    ap.add_argument("--mapping-out", required=True)
    a = ap.parse_args(argv)
    prev = json.load(open(a.prev)) if os.path.exists(a.prev) else None
    state = json.load(open(a.state))
    meta_channels = {s["tab"]: [ch["id"].split("|")[1] for ch in s["channels"] if ch["kind"] == "meta"]
                     for s in state["structures"]}
    roster = accounts_mod.load_accounts(a.roster)
    merged = label_accounts(merge_with_previous(normalize(a.raw), prev, a.as_of), roster)
    spend_ids = {r["campaign_id"] for r in merged["daily"] if r["spend"] > 0}
    titles = {ch["id"]: ch["title"] for s in state["structures"] for ch in s["channels"] if ch["kind"] == "meta"}
    rows = auto_mapping(merged["campaigns"], roster, state.get("mapping", []),
                        meta_channels, spend_ids, titles)
    backfill = title_backfill(state.get("mapping", []), titles)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(merged, f, ensure_ascii=False, separators=(",", ":"))
    with open(a.mapping_out, "w") as f:
        json.dump(rows + backfill, f, ensure_ascii=False, indent=1)
    failed = [k for k, v in merged["accounts"].items() if not v["ok"]]
    print(json.dumps({"accounts": len(merged["accounts"]), "failed": failed, "campaigns": len(merged["campaigns"]),
                      "daily_rows": len(merged["daily"]), "new_mapping_rows": len(rows)}))


if __name__ == "__main__":
    main()
