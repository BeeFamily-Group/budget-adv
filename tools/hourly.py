"""Parte deterministica della routine oraria che applica su Meta le richieste di Francesco.

  hourly.py pending  -> raw_hourly/pending.json, state.json e plan.json (letture fresche degli account coinvolti)
  hourly.py changes  -> raw_hourly/changes.json: per ogni richiesta, le entita' da aggiornare e il nuovo budget
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(__file__))
import apply_plan  # noqa: E402
import build_meta  # noqa: E402
import harvest_meta  # noqa: E402
import meta_plan  # noqa: E402
import routine_api  # noqa: E402

RAW = "raw_hourly"


def accounts_for_requests(requests, mapping):
    wanted = {r["channel_id"] for r in requests}
    return {str(m["account_id"]): m["channel_id"].split("|")[0] for m in mapping if m.get("channel_id") in wanted}


def pending():
    shutil.rmtree(RAW, ignore_errors=True)
    os.makedirs(RAW)
    reqs = routine_api.post("pendingRequests", {}).get("requests", [])
    state = routine_api.get_state()
    plan = meta_plan.build_plan(accounts_for_requests(reqs, state["mapping"]), daily=False)
    for name, obj in (("pending", reqs), ("state", state), ("plan", plan)):
        with open(os.path.join(RAW, name + ".json"), "w") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
    print(json.dumps({"richieste": len(reqs), "letture_meta": len(plan["calls"]), "run_id": plan["run_id"],
                      "dettaglio": [{"id": r["id"], "canale": r["channel_id"], "mese": r["ym"], "eur": r["eur"]} for r in reqs]},
                     ensure_ascii=False))


def changes():
    plan = json.load(open(os.path.join(RAW, "plan.json")))
    h = harvest_meta.harvest(plan, harvest_meta.transcripts(0.75), RAW)
    campaigns = build_meta.normalize(RAW)["campaigns"]
    state = json.load(open(os.path.join(RAW, "state.json")))
    out = []
    for r in json.load(open(os.path.join(RAW, "pending.json"))):
        acc = sorted(a for a, tab in accounts_for_requests([r], state["mapping"]).items())
        failed = [a for a in acc if a in h["failed"]]
        out.append({"request_id": r["id"], "channel_id": r["channel_id"], "eur": r["eur"],
                    "ad_account_id": acc[0] if len(acc) == 1 else acc,
                    "lettura_fallita": failed,
                    "changes": [] if failed else apply_plan.plan_changes(r, campaigns, state["mapping"])})
    with open(os.path.join(RAW, "changes.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    {"pending": pending, "changes": changes}[sys.argv[1]]()
