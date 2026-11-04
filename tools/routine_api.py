"""Chiamate della routine alla web app: stato, mappa campagne, speso Meta nello Sheet, richieste Meta.

La chiave della routine sta nel Portachiavi (servizio budget-adv-routine), mai nel repo.
"""
import json
import os
import re
import subprocess
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import spend as spend_mod  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def web_app_url():
    text = open(os.path.join(ROOT, "docs", "config.js")).read()
    return re.search(r"WEB_APP_URL\s*=\s*'([^']+)'", text).group(1)


def routine_key():
    return subprocess.check_output(["security", "find-generic-password", "-s", "budget-adv-routine", "-w"],
                                   text=True).strip()


def get_state():
    with urllib.request.urlopen(web_app_url() + "?action=state&fresh=1", timeout=120) as r:
        return json.loads(r.read())


def post(action, payload):
    body = dict(payload, action=action, routine_key=routine_key())
    req = urllib.request.Request(web_app_url(), data=json.dumps(body).encode(),
                                 headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())


def sync_spend(meta_path):
    meta = json.load(open(meta_path))
    state = get_state()
    channels = {ch["id"]: ch["title"] for s in state["structures"] for ch in s["channels"] if ch["kind"] == "meta"}
    as_of = meta["as_of"]
    y, m = int(as_of[:4]), int(as_of[5:7])
    prev = "%04d-%02d" % ((y - 1, 12) if m == 1 else (y, m - 1))
    items = spend_mod.spend_items(meta, state["mapping"], channels, [prev, as_of[:7]])
    return post("writeSpendBatch", {"items": items})


def main():
    cmd = sys.argv[1]
    if cmd == "state":
        print(json.dumps(get_state(), ensure_ascii=False))
    elif cmd == "post":
        payload = sys.argv[3]
        if payload.startswith("@"):
            payload = open(payload[1:]).read()
        data = json.loads(payload)
        if isinstance(data, list):
            data = {"rows": data}
        print(json.dumps(post(sys.argv[2], data), ensure_ascii=False))
    elif cmd == "spend":
        print(json.dumps(sync_spend(sys.argv[2]), ensure_ascii=False))
    else:
        sys.exit("uso: routine_api.py state | post AZIONE JSON|@file | spend docs/data/meta.json")


if __name__ == "__main__":
    main()
