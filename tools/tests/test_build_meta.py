import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import accounts  # noqa: E402
import build_meta  # noqa: E402

ACCOUNTS = {"421004342260012": "Ciccio", "1576344015714351": "COLOR", "432856047384850": "Cirillo",
            "433491253104777": "B612", "608324351982441": "Sardinia"}
META_CHANNELS = {"Ciccio": ["A"], "Cirillo": ["A", "J"], "B612": ["A"], "Sardinia": [],
                 "Color Perla Village": ["A"], "Color Bay Village": ["A"], "Color Palace Lido": ["A"]}


def eur(v):
    return {"value": str(v), "unit": "EUR"}


def write(d, name, obj):
    with open(os.path.join(d, name), "w") as f:
        json.dump(obj, f)


class AutoMapping(unittest.TestCase):
    def camp(self, cid, name, account, status="ACTIVE"):
        return {"id": cid, "name": name, "account_id": account, "status": status}

    def test_color_mapping(self):
        rows = build_meta.auto_mapping(
            [self.camp("1", "Perla Village - Estate 2027", "1576344015714351"),
             self.camp("2", "Bay - Estate 2027", "1576344015714351"),
             self.camp("3", "Color Flex Pay - Rete", "1576344015714351")],
            ACCOUNTS, [], META_CHANNELS, spend_ids=set())
        got = {r["campaign_id"]: r["channel_id"] for r in rows}
        self.assertEqual(got, {"1": "Color Perla Village|A", "2": "Color Bay Village|A", "3": ""})

    def test_cirillo_estero(self):
        rows = build_meta.auto_mapping(
            [self.camp("9", "Cirillo Estero Primavera", "432856047384850"),
             self.camp("10", "Cirillo Estate Italia", "432856047384850")],
            ACCOUNTS, [], META_CHANNELS, spend_ids=set())
        got = {r["campaign_id"]: r["channel_id"] for r in rows}
        self.assertEqual(got, {"9": "Cirillo|J", "10": "Cirillo|A"})

    def test_existing_mapping_kept(self):
        existing = [{"account_id": "421004342260012", "campaign_id": "5", "campaign_name": "X", "channel_id": ""}]
        rows = build_meta.auto_mapping([self.camp("5", "Vecchia Polsa", "421004342260012")],
                                       ACCOUNTS, existing, META_CHANNELS, spend_ids=set())
        self.assertEqual(rows, [])

    def test_only_active_or_spending_mapped(self):
        rows = build_meta.auto_mapping(
            [self.camp("7", "Sorriso 2023", "421004342260012", status="PAUSED"),
             self.camp("8", "HALLOWEEN_2026", "421004342260012", status="PAUSED")],
            ACCOUNTS, [], META_CHANNELS, spend_ids={"8"})
        self.assertEqual([r["campaign_id"] for r in rows], ["8"])

    def test_account_without_meta_block(self):
        rows = build_meta.auto_mapping([self.camp("11", "Ville estate", "608324351982441")],
                                       ACCOUNTS, [], META_CHANNELS, spend_ids=set())
        self.assertEqual(rows[0]["channel_id"], "")


class Normalize(unittest.TestCase):
    def test_adset_budget_level_and_daily(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "433491253104777_campaigns.json",
                  [{"id": "c1", "name": "Mercatini", "effective_status": "ACTIVE"}])
            write(d, "433491253104777_adsets.json",
                  [{"id": "s1", "campaign_id": "c1", "effective_status": "ACTIVE", "daily_budget": eur(25)},
                   {"id": "s2", "campaign_id": "c1", "effective_status": "PAUSED", "daily_budget": eur(13)}])
            write(d, "433491253104777_daily.json",
                  [{"date_start": "2026-11-01", "date_stop": "2026-11-01", "amount_spent": eur("24.5"),
                    "lead": "3", "id": "c1", "name": "Mercatini"}])
            out = build_meta.normalize(d)
        c = out["campaigns"][0]
        self.assertEqual(c["budget_level"], "adset")
        self.assertEqual(c["daily_budget"], 25)
        self.assertEqual(c["adsets"][1], {"id": "s2", "status": "PAUSED", "daily_budget": 13})
        self.assertEqual(out["daily"], [{"campaign_id": "c1", "date": "2026-11-01", "spend": 24.5, "leads": 3}])
        self.assertEqual(out["accounts"]["433491253104777"]["ok"], True)

    def test_campaign_only_in_daily_is_kept(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "421004342260012_campaigns.json",
                  [{"id": "s27", "name": "SUMMER_2027", "effective_status": "ACTIVE", "daily_budget": eur(60)}])
            write(d, "421004342260012_adsets.json", [])
            write(d, "421004342260012_daily.json",
                  [{"date_start": "2026-10-31", "date_stop": "2026-10-31", "amount_spent": eur("15.97"),
                    "lead": "1", "id": "h26", "name": "HALLOWEEN_2026"}])
            out = build_meta.normalize(d)
        by_id = {c["id"]: c for c in out["campaigns"]}
        self.assertEqual(by_id["s27"]["budget_level"], "campaign")
        self.assertEqual(by_id["s27"]["daily_budget"], 60)
        self.assertEqual(by_id["h26"]["status"], "NOT_ACTIVE")

    def test_empty_days_without_id_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            write(d, "421004342260012_campaigns.json", [])
            write(d, "421004342260012_adsets.json", [])
            write(d, "421004342260012_daily.json",
                  [{"date_start": "2026-11-02", "date_stop": "2026-11-02"},
                   {"date_start": "2026-11-01", "date_stop": "2026-11-01", "amount_spent": eur("15.01"),
                    "lead": "1", "id": "h26", "name": "HALLOWEEN_2026"}])
            out = build_meta.normalize(d)
        self.assertEqual([r["campaign_id"] for r in out["daily"]], ["h26"])

    def test_failed_account_keeps_previous(self):
        prev = {"as_of": "2026-11-13",
                "accounts": {"433491253104777": {"ok": True, "error": None, "last_ok": "2026-11-13"}},
                "campaigns": [{"id": "c1", "account_id": "433491253104777", "name": "Mercatini", "status": "ACTIVE",
                               "daily_budget": 25, "budget_level": "adset", "adsets": []}],
                "daily": [{"campaign_id": "c1", "date": "2026-11-13", "spend": 25.0, "leads": 2}]}
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "433491253104777_error.txt"), "w") as f:
                f.write("Account not queryable")
            new = build_meta.normalize(d)
        merged = build_meta.merge_with_previous(new, prev, as_of="2026-11-14")
        self.assertEqual(merged["accounts"]["433491253104777"],
                         {"ok": False, "error": "Account not queryable", "last_ok": "2026-11-13"})
        self.assertEqual(merged["daily"], prev["daily"])
        self.assertEqual(merged["campaigns"][0]["id"], "c1")
        self.assertEqual(merged["as_of"], "2026-11-14")


class Accounts(unittest.TestCase):
    def test_roster_aliases(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "roster.json")
            write(d, "roster.json", {"meta_ids": {"Delta Blu": "act_236880885374018",
                                                  "Color Holiday": "act_1576344015714351",
                                                  "Ciccio": "act_421004342260012"}})
            got = accounts.load_accounts(p)
        self.assertEqual(got, {"236880885374018": "DeltaBlu", "1576344015714351": "COLOR",
                               "421004342260012": "Ciccio"})


if __name__ == "__main__":
    unittest.main()
