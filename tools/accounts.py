"""Account Meta del roster BeeFamily -> tab dello Sheet budget."""
import json

# Nomi del roster che nello Sheet hanno un tab con nome diverso. COLOR = account di rete degli 11 hotel.
ALIASES = {"Delta Blu": "DeltaBlu", "Color Holiday": "COLOR"}


def load_accounts(roster_path):
    with open(roster_path) as f:
        roster = json.load(f)
    out = {}
    for name, act in roster.get("meta_ids", {}).items():
        out[str(act).replace("act_", "")] = ALIASES.get(name, name)
    return out
