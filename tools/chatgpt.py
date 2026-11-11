"""ChatGPT Ads nella routine notturna (11/11/2026): speso e clic del mese per i blocchi ChatGPT dello Sheet.

Solo lettura sulle campagne: legge con ~/bin/openai-ads (chiave nel Portachiavi, mai stampata) e manda alla web app
l'azione saveChatgpt (tab CHATGPT + Spesa Effettiva del mese). Periodo come Meta: dal primo del mese a ieri;
il primo del mese chiude il mese prima. I clic vanno in leads_mtd: la dashboard li mostra come clic, non come lead.
"""
import datetime
import json
import os
import subprocess
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(__file__))

ROME = ZoneInfo("Europe/Rome")
OPENAI_ADS = os.path.expanduser("~/bin/openai-ads")

# Un blocco per riga. service = voce del Portachiavi con la chiave dell'ad account (una chiave = un account).
# Senza "campaigns" si contano tutte le campagne dell'account.
CHANNELS = [
    {"channel_id": "Color Holiday - Chatgpt ADS|A", "title": "BUDGET CHATGPT ADS", "service": "openai-ads-api"},
]


def period(today):
    """(dal, al) in YYYY-MM-DD: dal primo del mese di ieri a ieri."""
    y = today - datetime.timedelta(days=1)
    return y.replace(day=1).isoformat(), y.isoformat()


def rome_day(row):
    return datetime.datetime.fromtimestamp(int(row["start_time"]), ROME).date().isoformat()


def month_totals(rows, since, until):
    spend, clicks = 0.0, 0
    for r in rows:
        if since <= rome_day(r) <= until:
            spend += float(r.get("spend") or 0)
            clicks += int(r.get("clicks") or 0)
    return round(spend, 2), clicks


def channel_payload(channel, campaigns, insights, since, until):
    spend, clicks = 0.0, 0
    for c in campaigns:
        s, k = month_totals(insights.get(c["id"], []), since, until)
        spend += s
        clicks += k
    active = [c for c in campaigns if c.get("status") == "active"]
    budget = sum(int((c.get("budget") or {}).get("daily_spend_limit_micros") or 0) for c in active) / 1e6
    return {"channel_id": channel["channel_id"], "title": channel["title"], "date": until,
            "spent_mtd": round(spend, 2), "leads_mtd": clicks, "daily_budget": round(budget, 2), "active": bool(active)}


def parse_response(text):
    body, _, code = text.rpartition("HTTP ")
    status = int(code.strip() or 0)
    if status != 200:
        raise RuntimeError("OpenAI Ads HTTP %s: %s" % (status, body.strip()[:200]))
    return status, json.loads(body)


def api_get(service):
    def get(path):
        out = subprocess.run([OPENAI_ADS, "-s", service, "GET", path], capture_output=True, text=True, timeout=120)
        return parse_response(out.stdout)[1]
    return get


INSIGHT_FIELDS = "fields[]=impressions&fields[]=clicks&fields[]=spend"


def all_insights(get, campaign_id):
    """Righe giornaliere della campagna (l'API ignora il periodo: dà tutti i giorni, a pagine)."""
    rows, after = [], None
    for _ in range(50):
        path = "/campaigns/%s/insights?limit=100&%s" % (campaign_id, INSIGHT_FIELDS) + ("&after=%s" % after if after else "")
        page = get(path)
        rows.extend(page.get("data", []))
        if not page.get("has_more") or not page.get("last_id"):
            break
        after = page["last_id"]
    return rows


def read_channel(channel, today, get=None):
    get = get or api_get(channel.get("service", "openai-ads-api"))
    since, until = period(today)
    campaigns = get("/campaigns").get("data", [])
    if channel.get("campaigns"):
        campaigns = [c for c in campaigns if c["id"] in channel["campaigns"]]
    insights = {c["id"]: all_insights(get, c["id"]) for c in campaigns}
    return channel_payload(channel, campaigns, insights, since, until)


def main():
    import routine_api  # solo qui: i test non toccano la web app
    today = datetime.datetime.now(ROME).date()
    out = []
    for ch in CHANNELS:
        try:
            p = read_channel(ch, today)
            r = routine_api.post("saveChatgpt", p)
            out.append("%s: %.2f € · %d clic · %s" % (ch["channel_id"], p["spent_mtd"], p["leads_mtd"], "ok" if r.get("ok") else "ERRORE " + str(r.get("error"))))
        except Exception as e:  # un errore ChatGPT non ferma la routine Meta
            out.append("%s: ERRORE %s" % (ch["channel_id"], e))
    print(" | ".join(out))


if __name__ == "__main__":
    main()
