"""TikTok Ads nella routine notturna (19/11/2026): card "Color Holiday", dati da Windsor.ai senza numeri ricopiati a mano."""
import datetime
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import meta_plan  # noqa: E402
import tiktok  # noqa: E402

ACC = "7709484493702447105"


class Calls(unittest.TestCase):
    def test_call_from_first_of_month_to_yesterday(self):
        calls = tiktok.windsor_calls(datetime.date(2026, 11, 20))
        self.assertEqual(calls, [{"key": "tiktok_" + ACC, "channel_id": "Color Holiday - Rete ADS|J", "args": {
            "connector": "tiktok", "accounts": [ACC], "fields": ["date", "spend", "clicks", "impressions"],
            "date_from": "2026-11-01", "date_to": "2026-11-19"}}])

    def test_first_of_month_closes_previous(self):
        a = tiktok.windsor_calls(datetime.date(2026, 12, 1))[0]["args"]
        self.assertEqual((a["date_from"], a["date_to"]), ("2026-11-01", "2026-11-30"))

    def test_plan_carries_windsor_calls(self):
        p = meta_plan.build_plan({"421004342260012": "Ciccio"}, today=datetime.date(2026, 11, 20))
        self.assertEqual([c["key"] for c in p["windsor_calls"]], ["tiktok_" + ACC])


def transcript(lines):
    f = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
    for o in lines:
        f.write(json.dumps(o) + "\n")
    f.close()
    return f.name


def use(uid, args, name="mcp__c87c8c90__get_data"):
    return {"message": {"content": [{"type": "tool_use", "id": uid, "name": name, "input": dict(args, reasoning="x")}]}}


def result(uid, body):
    return {"message": {"content": [{"type": "tool_result", "tool_use_id": uid, "content": [{"type": "text", "text": json.dumps(body)}]}]}}


class Harvest(unittest.TestCase):
    CALL = tiktok.windsor_calls(datetime.date(2026, 11, 20))[0]

    def test_takes_done_result_of_the_exact_call(self):
        rows = [{"date": "2026-11-19", "spend": 18.2, "clicks": 30, "impressions": 2000}]
        other = dict(self.CALL["args"], date_from="2026-10-01")
        p = transcript([use("a", other), result("a", {"status": "done", "data": [{"date": "2026-10-03", "spend": 999, "clicks": 1}]}),
                        use("b", self.CALL["args"]), result("b", {"status": "pending", "job_id": "j"}),
                        use("c", self.CALL["args"]), result("c", {"status": "done", "data": rows, "total_rows": 1})])
        with tempfile.TemporaryDirectory() as raw:
            out = tiktok.harvest([self.CALL], [p], raw)
            self.assertEqual(out, {"ok": ["tiktok_" + ACC], "failed": []})
            self.assertEqual(json.load(open(os.path.join(raw, "tiktok_%s.json" % ACC))), rows)

    def test_missing_or_only_pending_is_an_error(self):
        p = transcript([use("b", self.CALL["args"]), result("b", {"status": "pending", "job_id": "j"})])
        with tempfile.TemporaryDirectory() as raw:
            out = tiktok.harvest([self.CALL], [p], raw)
            self.assertEqual(out["failed"], ["tiktok_" + ACC])
            self.assertTrue(os.path.exists(os.path.join(raw, "tiktok_%s_error.txt" % ACC)))

    def test_result_wrapped_in_result_key(self):
        p = transcript([use("c", self.CALL["args"]), result("c", {"result": {"status": "done", "data": [], "total_rows": 0}})])
        with tempfile.TemporaryDirectory() as raw:
            self.assertEqual(tiktok.harvest([self.CALL], [p], raw)["ok"], ["tiktok_" + ACC])


class Payload(unittest.TestCase):
    CALL = tiktok.windsor_calls(datetime.date(2026, 11, 20))[0]

    def test_month_totals_and_active_from_yesterday(self):
        rows = [{"date": "2026-11-19", "spend": 18.2, "clicks": 30}, {"date": "2026-11-18", "spend": "11.2", "clicks": "21"},
                {"date": "2026-10-31", "spend": 50, "clicks": 9}]
        p = tiktok.payload(self.CALL, rows)
        self.assertEqual(p, {"channel_id": "Color Holiday - Rete ADS|J", "title": "BUDGET TIKTOK ADS", "date": "2026-11-19",
                             "spent_mtd": 29.4, "leads_mtd": 51, "daily_budget": 0, "active": True})

    def test_no_rows_is_zero_and_not_active(self):
        p = tiktok.payload(self.CALL, [])
        self.assertEqual((p["spent_mtd"], p["leads_mtd"], p["active"]), (0.0, 0, False))


if __name__ == "__main__":
    unittest.main()
