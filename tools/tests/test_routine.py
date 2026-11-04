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


def tool_use(uid, args, run_id=None):
    inp = dict(args, client_conversation_id=run_id) if run_id else args
    return {"message": {"content": [{"type": "tool_use", "id": uid,
                                     "name": "mcp__05eac03e__ads_get_ad_entities", "input": inp}]}}


def tool_result(uid, payload):
    return {"message": {"content": [{"type": "tool_result", "tool_use_id": uid,
                                     "content": [{"type": "text", "text": json.dumps(payload)}]}]}}


class Harvest(unittest.TestCase):
    def test_pages_merged_and_missing_call_is_error(self):
        plan = meta_plan.build_plan({"421004342260012": "Ciccio", "433491253104777": "B612"},
                                    today=datetime.date(2026, 11, 15))
        calls = {c["key"]: dict(c["args"], client_conversation_id=plan["run_id"]) for c in plan["calls"]}
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


def write_transcript(d, name, lines):
    tr = os.path.join(d, name)
    with open(tr, "w") as f:
        for line in lines:
            f.write(json.dumps(line) + "\n")
    return tr


def camp(cid, name):
    return {"id": cid, "name": name, "effective_status": "ACTIVE", "daily_budget": {"value": "10", "unit": "EUR"}}


class HarvestRun(unittest.TestCase):
    """Review C1 e I4: contano solo le letture di QUESTA run, e solo se complete."""

    def setUp(self):
        self.plan = meta_plan.build_plan({"421004342260012": "Ciccio"}, today=datetime.date(2026, 11, 15), daily=False)
        self.args = {c["key"]: c["args"] for c in self.plan["calls"]}
        self.rid = self.plan["run_id"]

    def harvest(self, *transcripts):
        with tempfile.TemporaryDirectory() as d:
            paths = [write_transcript(d, "t%d.jsonl" % i, lines) for i, lines in enumerate(transcripts)]
            raw = os.path.join(d, "raw")
            out = harvest_meta.harvest(self.plan, paths, raw)
            got = {}
            for k in self.args:
                f = os.path.join(raw, k + ".json")
                got[k] = [r["id"] for r in json.load(open(f))] if os.path.exists(f) else None
            err = os.path.join(raw, "421004342260012_error.txt")
            got["error"] = open(err).read() if os.path.exists(err) else None
            return out, got

    def test_run_id_is_20_alphanumeric_and_new_each_time(self):
        other = meta_plan.build_plan({}, today=datetime.date(2026, 11, 15))
        self.assertRegex(self.rid, r"^[A-Za-z0-9]{20}$")
        self.assertNotEqual(self.rid, other["run_id"])

    def test_reads_of_another_run_are_ignored(self):
        old = [tool_use("o1", self.args["421004342260012_campaigns"], "OLDRUNOLDRUNOLDRUN00"),
               tool_result("o1", {"ad_entities": json.dumps([camp("h26", "HALLOWEEN"), camp("s27", "SUMMER")])}),
               tool_use("o2", self.args["421004342260012_adsets"], "OLDRUNOLDRUNOLDRUN00"),
               tool_result("o2", {"ad_entities": "[]"})]
        new = [tool_use("n1", self.args["421004342260012_campaigns"], self.rid),
               tool_result("n1", {"ad_entities": json.dumps([camp("s27", "SUMMER")])}),
               tool_use("n2", self.args["421004342260012_adsets"], self.rid),
               tool_result("n2", {"ad_entities": "[]"})]
        out, got = self.harvest(old, new)
        self.assertEqual(out["ok"], ["421004342260012"])
        self.assertEqual(got["421004342260012_campaigns"], ["s27"])

    def test_only_other_run_means_missing(self):
        old = [tool_use("o1", self.args["421004342260012_campaigns"], "OLDRUNOLDRUNOLDRUN00"),
               tool_result("o1", {"ad_entities": json.dumps([camp("s27", "SUMMER")])})]
        out, got = self.harvest(old)
        self.assertEqual(out["failed"], ["421004342260012"])
        self.assertIn("chiamata mancante", got["error"])

    def test_repeated_first_page_restarts_the_list(self):
        lines = [tool_use("a", self.args["421004342260012_campaigns"], self.rid),
                 tool_result("a", {"ad_entities": json.dumps([camp("h26", "HALLOWEEN"), camp("s27", "SUMMER")])}),
                 tool_use("b", self.args["421004342260012_campaigns"], self.rid),
                 tool_result("b", {"ad_entities": json.dumps([camp("s27", "SUMMER")])}),
                 tool_use("c", self.args["421004342260012_adsets"], self.rid),
                 tool_result("c", {"ad_entities": "[]"})]
        out, got = self.harvest(lines)
        self.assertEqual(got["421004342260012_campaigns"], ["s27"])

    def test_unfollowed_next_cursor_is_an_error(self):
        lines = [tool_use("a", self.args["421004342260012_campaigns"], self.rid),
                 tool_result("a", {"ad_entities": json.dumps([camp("s27", "SUMMER")]),
                                   "pagination": {"next_cursor": "abc"}}),
                 tool_use("c", self.args["421004342260012_adsets"], self.rid),
                 tool_result("c", {"ad_entities": "[]"})]
        out, got = self.harvest(lines)
        self.assertEqual(out["failed"], ["421004342260012"])
        self.assertIn("pagine mancanti", got["error"])

    def test_failed_second_page_is_an_error(self):
        lines = [tool_use("a", self.args["421004342260012_campaigns"], self.rid),
                 tool_result("a", {"ad_entities": json.dumps([camp("s27", "SUMMER")]),
                                   "pagination": {"next_cursor": "abc"}}),
                 tool_use("b", dict(self.args["421004342260012_campaigns"], cursor="abc"), self.rid),
                 tool_result("b", {"error": "timeout"}),
                 tool_use("c", self.args["421004342260012_adsets"], self.rid),
                 tool_result("c", {"ad_entities": "[]"})]
        out, got = self.harvest(lines)
        self.assertEqual(out["failed"], ["421004342260012"])
        self.assertIn("timeout", got["error"])


class Spend(unittest.TestCase):
    def test_items_per_channel_and_month(self):
        meta = {"daily": [{"campaign_id": "s27", "date": "2026-10-31", "spend": 55.53, "leads": 18},
                          {"campaign_id": "s27", "date": "2026-11-01", "spend": 68.19, "leads": 18},
                          {"campaign_id": "h26", "date": "2026-11-01", "spend": 15.01, "leads": 1},
                          {"campaign_id": "zz", "date": "2026-11-01", "spend": 9.0, "leads": 0}]}
        mapping = [{"campaign_id": "s27", "channel_id": "Ciccio|A"}, {"campaign_id": "h26", "channel_id": "Ciccio|A"},
                   {"campaign_id": "zz", "channel_id": ""}]
        items = spend.spend_items(meta, mapping, {"Ciccio|A": "BUDGET FACEBOOK ADS", "Brora|A": "BUDGET FACEBOOK ADS"},
                                  ["2026-10", "2026-11"])
        self.assertEqual(items, [{"channel_id": "Ciccio|A", "title": "BUDGET FACEBOOK ADS", "ym": "2026-10", "value": 55.53},
                                 {"channel_id": "Ciccio|A", "title": "BUDGET FACEBOOK ADS", "ym": "2026-11", "value": 83.2}])


if __name__ == "__main__":
    unittest.main()


class SpendTitles(unittest.TestCase):
    def test_rows_with_another_title_are_not_written(self):
        meta = {"daily": [{"campaign_id": "ita", "date": "2026-11-01", "spend": 10.0, "leads": 1},
                          {"campaign_id": "est", "date": "2026-11-01", "spend": 7.0, "leads": 1}]}
        mapping = [{"campaign_id": "ita", "channel_id": "Cirillo|A", "channel_title": "BUDGET FACEBOOK ADS ITALIA"},
                   {"campaign_id": "est", "channel_id": "Cirillo|A", "channel_title": "BUDGET FACEBOOK ADS ESTERO"}]
        items = spend.spend_items(meta, mapping, {"Cirillo|A": "BUDGET FACEBOOK ADS ESTERO"}, ["2026-11"])
        self.assertEqual(items, [{"channel_id": "Cirillo|A", "title": "BUDGET FACEBOOK ADS ESTERO", "ym": "2026-11", "value": 7.0}])


class PlanTargeting(unittest.TestCase):
    def test_targeting_only_for_accounts_with_two_meta_blocks(self):
        accounts = {"432856047384850": "Cirillo", "421004342260012": "Ciccio"}
        state = {"structures": [
            {"tab": "Cirillo", "channels": [{"id": "Cirillo|A", "kind": "meta"}, {"id": "Cirillo|J", "kind": "meta"}]},
            {"tab": "Ciccio", "channels": [{"id": "Ciccio|A", "kind": "meta"}, {"id": "Ciccio|J", "kind": "google"}]}]}
        multi = meta_plan.multi_meta_accounts(accounts, state)
        self.assertEqual(multi, {"432856047384850"})
        p = meta_plan.build_plan(accounts, today=datetime.date(2026, 11, 15), targeting=multi)
        fields = {c["key"]: c["args"]["fields"] for c in p["calls"]}
        self.assertIn("targeting", fields["432856047384850_adsets"])
        self.assertNotIn("targeting", fields["421004342260012_adsets"])


class ResultFiles(unittest.TestCase):
    """Un risultato grande l'harness lo salva in tool-results/: solo quei file si aprono, mai altri percorsi citati."""

    def block(self, text):
        return {"content": [{"type": "text", "text": text}]}

    def test_only_harness_tool_results_are_opened(self):
        with tempfile.TemporaryDirectory() as root:
            tr = os.path.join(root, "proj", "tool-results")
            os.makedirs(tr)
            good = os.path.join(tr, "big.json")
            with open(good, "w") as f:
                f.write('{"ad_entities": "[]"}')
            other = os.path.join(root, "segreto.txt")
            with open(other, "w") as f:
                f.write("non deve uscire")
            old = harvest_meta.TOOL_RESULTS_ROOT
            harvest_meta.TOOL_RESULTS_ROOT = root
            try:
                self.assertEqual(harvest_meta._result_text(self.block("Output saved to " + good)), '{"ad_entities": "[]"}')
                self.assertNotIn("non deve uscire", harvest_meta._result_text(self.block("vedi " + other)))
                outside = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
                outside.write('{"x": 1}')
                outside.close()
                self.assertNotIn('"x"', harvest_meta._result_text(self.block("vedi " + outside.name)))
                os.unlink(outside.name)
            finally:
                harvest_meta.TOOL_RESULTS_ROOT = old


class FreshRead(unittest.TestCase):
    def test_plan_without_daily(self):
        p = meta_plan.build_plan({"421004342260012": "Ciccio"}, today=datetime.date(2026, 11, 15), daily=False)
        self.assertEqual([c["key"] for c in p["calls"]], ["421004342260012_campaigns", "421004342260012_adsets"])
