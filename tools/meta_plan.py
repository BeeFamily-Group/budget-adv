"""Chiamate Meta della routine notturna, con i parametri esatti (date calcolate su oggi a Roma)."""
import argparse
import datetime
import json
import os
import secrets
import string
import sys

sys.path.insert(0, os.path.dirname(__file__))
import accounts as accounts_mod  # noqa: E402

ROSTER = os.path.expanduser("~/Desktop/CLAUDE CODE/BEEFAMILY/DOWNLOAD FATTURE/_automation/roster_beefamily.json")


def today_rome():
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo("Europe/Rome")).date()
    except Exception:  # Python senza zoneinfo: UTC+1 basta per decidere il giorno
        return (datetime.datetime.utcnow() + datetime.timedelta(hours=1)).date()


def new_run_id():
    """client_conversation_id della run: le letture con un id diverso (altre run) non vengono usate."""
    abc = string.ascii_letters + string.digits
    return "".join(secrets.choice(abc) for _ in range(20))


def multi_meta_accounts(accounts, state):
    """Account dei tab con piu' blocchi Meta (oggi Cirillo: Italia ed Estero): per loro si legge anche il target."""
    tabs = {s["tab"] for s in (state or {}).get("structures", [])
            if sum(1 for ch in s["channels"] if ch["kind"] == "meta") > 1}
    return {acc for acc, tab in accounts.items() if tab in tabs}


def build_plan(accounts, today=None, daily=True, targeting=()):
    today = today or today_rome()
    until = today - datetime.timedelta(days=1)
    first_this = until.replace(day=1)
    first_prev = (first_this - datetime.timedelta(days=1)).replace(day=1)
    # due mesi prima del mese di ieri: storico di 2-3 mesi per il grafico dell'andamento
    since = (first_prev - datetime.timedelta(days=1)).replace(day=1)
    rng = json.dumps({"since": since.isoformat(), "until": until.isoformat()}, separators=(",", ":"))
    active = [{"field": "effective_status", "operator": "IN", "value": ["ACTIVE"]}]
    calls = []
    for acc in sorted(accounts):
        calls.append({"key": acc + "_campaigns", "args": {
            "ad_account_id": acc, "level": "campaign", "limit": 500, "filtering": active,
            "fields": ["id", "name", "effective_status", "daily_budget", "lifetime_budget"]}})
        adset_fields = ["id", "campaign_id", "effective_status", "daily_budget"]
        if acc in targeting:
            adset_fields.append("targeting")
        calls.append({"key": acc + "_adsets", "args": {
            "ad_account_id": acc, "level": "adset", "limit": 500, "filtering": active, "fields": adset_fields}})
        if not daily:
            continue
        calls.append({"key": acc + "_daily", "args": {
            "ad_account_id": acc, "level": "campaign", "limit": 1000, "time_range": rng, "time_increment": "1",
            "filtering": [{"field": "amount_spent", "operator": "GREATER_THAN", "value": ["0"]}],
            "fields": ["id", "name", "amount_spent", "lead"]}})
    return {"run_id": new_run_id(), "as_of": until.isoformat(), "since": since.isoformat(), "until": until.isoformat(),
            "calls": calls}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--roster", default=ROSTER)
    ap.add_argument("--out", default="raw/plan.json")
    ap.add_argument("--state", help="stato della web app: serve a sapere quali account hanno due blocchi Meta")
    a = ap.parse_args()
    accounts = accounts_mod.load_accounts(a.roster)
    try:
        state = json.load(open(a.state)) if a.state else None
    except (OSError, ValueError):
        state = None  # senza stato si legge come sempre, solo senza target
    plan = build_plan(accounts, targeting=multi_meta_accounts(accounts, state))
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(plan, f, indent=1)
    print(json.dumps(plan, indent=1))


if __name__ == "__main__":
    main()
