"""Come applicare su Meta una richiesta di Francesco: quali entita' toccare e con che budget.

Solo il budget giornaliero cambia. Il nuovo €/giorno del canale si divide sulle entita' attive
(campagne con budget di campagna, oppure adset con budget proprio) in proporzione al budget attuale.
"""
import argparse
import json
import math


def split(current, total):
    total = int(round(total))
    cur = [max(float(c or 0), 0.0) for c in current]
    if not cur:
        return []
    base = sum(cur)
    shares = [total * c / base for c in cur] if base > 0 else [total / len(cur)] * len(cur)
    out = [int(math.floor(s)) for s in shares]
    rest = total - sum(out)
    order = sorted(range(len(cur)), key=lambda i: shares[i] - out[i], reverse=True)
    for i in order[:rest]:
        out[i] += 1
    return out


def _entities(campaigns, ids):
    ents = []
    for c in campaigns:
        if str(c["id"]) not in ids or c.get("status") != "ACTIVE":
            continue
        if c.get("budget_level") == "adset":
            for a in c.get("adsets", []):
                if a.get("status") == "ACTIVE" and (a.get("daily_budget") or 0) > 0:
                    ents.append(("ad_set", str(a["id"]), a["daily_budget"]))
        else:
            ents.append(("campaign", str(c["id"]), c.get("daily_budget") or 0))
    return ents


def plan_changes(request, campaigns, mapping):
    if request.get("status") not in ("pending", "scheduled"):
        return []
    ids = {str(r["campaign_id"]) for r in mapping if r.get("channel_id") == request["channel_id"]}
    ents = _entities(campaigns, ids)
    new = split([e[2] for e in ents], request["eur"])
    return [{"entity_type": t, "entity_id": i, "old": _num(old), "new": n, "was_active": True}
            for (t, i, old), n in zip(ents, new)]


def _num(v):
    v = float(v or 0)
    return int(v) if v == int(v) else round(v, 2)


def after_update(changes, readback):
    reactivate, wrong = [], []
    for c in changes:
        rb = readback.get(c["entity_id"], {})
        if abs(float(rb.get("daily_budget") or 0) - c["new"]) > 0.5:
            wrong.append("%s (letto %s, atteso %s)" % (c["entity_id"], _num(rb.get("daily_budget")), c["new"]))
        if c["was_active"] and rb.get("status") != "ACTIVE":
            reactivate.append(c["entity_id"])
    if wrong:
        return {"ok": False, "reactivate": reactivate, "message": "budget non aggiornato: " + ", ".join(wrong)}
    msg = "applicato: " + ", ".join("%s %s→%s €/g" % (c["entity_id"], _num(c["old"]), c["new"]) for c in changes)
    if reactivate:
        msg += " · riattivate dopo la pausa automatica: " + ", ".join(reactivate)
    return {"ok": True, "reactivate": reactivate, "message": msg}


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--request", required=True, help="JSON della richiesta")
    p.add_argument("--meta", required=True, help="meta.json (campagne) o file con lettura fresca")
    p.add_argument("--state", required=True, help="stato della web app (mapping)")
    a = sub.add_parser("after")
    a.add_argument("--changes", required=True)
    a.add_argument("--readback", required=True, help='JSON {"entity_id": {"status":..., "daily_budget":...}}')
    args = ap.parse_args()
    if args.cmd == "plan":
        meta = json.load(open(args.meta))
        state = json.load(open(args.state))
        print(json.dumps(plan_changes(json.loads(args.request), meta["campaigns"], state["mapping"])))
    else:
        print(json.dumps(after_update(json.loads(args.changes), json.loads(args.readback)), ensure_ascii=False))


if __name__ == "__main__":
    main()
