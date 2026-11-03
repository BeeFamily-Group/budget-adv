"""Chiamate Meta della routine notturna, con i parametri esatti (date calcolate su oggi a Roma)."""
import argparse
import datetime
import json
import os
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


def build_plan(accounts, today=None, daily=True):
    today = today or today_rome()
    until = today - datetime.timedelta(days=1)
    first_this = until.replace(day=1)
    since = (first_this - datetime.timedelta(days=1)).replace(day=1)
    rng = json.dumps({"since": since.isoformat(), "until": until.isoformat()}, separators=(",", ":"))
    active = [{"field": "effective_status", "operator": "IN", "value": ["ACTIVE"]}]
    calls = []
    for acc in sorted(accounts):
        calls.append({"key": acc + "_campaigns", "args": {
            "ad_account_id": acc, "level": "campaign", "limit": 500, "filtering": active,
            "fields": ["id", "name", "effective_status", "daily_budget", "lifetime_budget"]}})
        calls.append({"key": acc + "_adsets", "args": {
            "ad_account_id": acc, "level": "adset", "limit": 500, "filtering": active,
            "fields": ["id", "campaign_id", "effective_status", "daily_budget"]}})
        if not daily:
            continue
        calls.append({"key": acc + "_daily", "args": {
            "ad_account_id": acc, "level": "campaign", "limit": 1000, "time_range": rng, "time_increment": "1",
            "filtering": [{"field": "amount_spent", "operator": "GREATER_THAN", "value": ["0"]}],
            "fields": ["id", "name", "amount_spent", "lead"]}})
    return {"as_of": until.isoformat(), "since": since.isoformat(), "until": until.isoformat(), "calls": calls}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--roster", default=ROSTER)
    ap.add_argument("--out", default="raw/plan.json")
    a = ap.parse_args()
    plan = build_plan(accounts_mod.load_accounts(a.roster))
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(plan, f, indent=1)
    print(json.dumps(plan, indent=1))


if __name__ == "__main__":
    main()
