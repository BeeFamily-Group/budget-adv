import datetime
import json
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import harvest_meta  # noqa: E402
import meta_plan  # noqa: E402
import spend  # noqa: E402


class Plan(unittest.TestCase):
    def test_dates_and_calls(self):
        p = meta_plan.build_plan({"421004342260012": "Ciccio"}, today=datetime.date(2026, 11, 15))
        self.assertEqual((p["as_of"], p["since"], p["until"]), ("2026-11-14", "2026-10-01", "2026-11-14"))
        keys = [c["key"] for c in p["calls"]]
        self.assertEqual(keys, ["421004342260012_campaigns", "421004342260012_adsets", "421004342260012_daily"])
        daily = p["calls"][2]["args"]
        self.assertEqual(daily["time_increment"], "1")
        self.assertEqual(json.loads(daily["time_range"]), {"since": "2026-10-01", "until": "2026-11-14"})

    def test_first_of_january(self):
        p = meta_plan.build_plan({}, today=datetime.date(2027, 1, 1))
        self.assertEqual((p["since"], p["until"]), ("2026-11-01", "2026-12-31"))  # mese di ieri (dic) + precedente (nov)


def tool_use(uid, args):
    return {"message": {"content": [{"type": "tool_use", "id": uid,
                                     "name": "mcp__05eac03e__ads_get_ad_entities", "input": args}]}}


def tool_result(uid, payload):
    return {"message": {"content": [{"type": "tool_result", "tool_use_id": uid,
                                     "content": [{"type": "text", "text": json.dumps(payload)}]}]}}


class Harvest(unittest.TestCase):
    def test_pages_merged_and_missing_call_is_error(self):
        plan = meta_plan.build_plan({"421004342260012": "Ciccio", "433491253104777": "B612"},
                                    today=datetime.date(2026, 11, 15))
        calls = {c["key"]: c["args"] for c in plan["calls"]}
        row = lambda d, cid: {"date_start": d, "date_stop": d, "amount_spent": {"value": "10", "unit": "EUR"},
                              "lead": "1", "id": cid, "name": "X"}
        lines = [
            tool_use("a", calls["421004342260012_campaigns"]),
            tool_result("a", {"ad_entities": json.dumps([{"id": "c1", "name": "X", "effective_status": "ACTIVE"}])}),
            tool_use("b", calls["421004342260012_adsets"]),
            tool_result("b", {"ad_entities": "[]"}),
            tool_use("c", calls["421004342260012_daily"]),
            tool_result("c", {"ad_entities": json.dumps([row("2026-11-01", "c1")]),
                              "pagination": {"next_cursor": "abc"}}),
            tool_use("d", dict(calls["421004342260012_daily"], cursor="abc")),
            tool_result("d", {"ad_entities": json.dumps([row("2026-11-02", "c1"), row("2026-11-01", "c1")])}),
            tool_use("e", calls["433491253104777_campaigns"]),
            tool_result("e", {"error": "Account not queryable"}),
        ]
        with tempfile.TemporaryDirectory() as d:
            tr = os.path.join(d, "s.jsonl")
            with open(tr, "w") as f:
                for line in lines:
                    f.write(json.dumps(line) + "\n")
            raw = os.path.join(d, "raw")
            out = harvest_meta.harvest(plan, [tr], raw)
            daily = json.load(open(os.path.join(raw, "421004342260012_daily.json")))
            self.assertEqual(sorted(r["date_start"] for r in daily), ["2026-11-01", "2026-11-02"])
            self.assertTrue(os.path.exists(os.path.join(raw, "433491253104777_error.txt")))
            self.assertIn("Account not queryable", open(os.path.join(raw, "433491253104777_error.txt")).read())
            self.assertEqual(out["ok"], ["421004342260012"])
            self.assertEqual(out["failed"], ["433491253104777"])


class Spend(unittest.TestCase):
    def test_items_per_channel_and_month(self):
        meta = {"daily": [{"campaign_id": "s27", "date": "2026-10-31", "spend": 55.53, "leads": 18},
                          {"campaign_id": "s27", "date": "2026-11-01", "spend": 68.19, "leads": 18},
                          {"campaign_id": "h26", "date": "2026-11-01", "spend": 15.01, "leads": 1},
                          {"campaign_id": "zz", "date": "2026-11-01", "spend": 9.0, "leads": 0}]}
        mapping = [{"campaign_id": "s27", "channel_id": "Ciccio|A"}, {"campaign_id": "h26", "channel_id": "Ciccio|A"},
                   {"campaign_id": "zz", "channel_id": ""}]
        items = spend.spend_items(meta, mapping, ["Ciccio|A", "Brora|A"], ["2026-10", "2026-11"])
        self.assertEqual(items, [{"channel_id": "Ciccio|A", "ym": "2026-10", "value": 55.53},
                                 {"channel_id": "Ciccio|A", "ym": "2026-11", "value": 83.2}])


if __name__ == "__main__":
    unittest.main()


class FreshRead(unittest.TestCase):
    def test_plan_without_daily(self):
        p = meta_plan.build_plan({"421004342260012": "Ciccio"}, today=datetime.date(2026, 11, 15), daily=False)
        self.assertEqual([c["key"] for c in p["calls"]], ["421004342260012_campaigns", "421004342260012_adsets"])
