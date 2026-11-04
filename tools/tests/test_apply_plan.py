import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import apply_plan  # noqa: E402

MAPPING = [{"campaign_id": "eng", "channel_id": "Helios|A"}, {"campaign_id": "ret", "channel_id": "Helios|A"},
           {"campaign_id": "s27", "channel_id": "Ciccio|A"}, {"campaign_id": "old", "channel_id": "Ciccio|A"},
           {"campaign_id": "merc", "channel_id": "B612|A"}]


def camp(cid, budget, status="ACTIVE", level="campaign", adsets=None):
    return {"id": cid, "status": status, "daily_budget": budget, "budget_level": level, "adsets": adsets or []}


class Split(unittest.TestCase):
    def test_split_helios(self):
        self.assertEqual(apply_plan.split([30, 10], 60), [45, 15])

    def test_split_rounding(self):
        self.assertEqual(sum(apply_plan.split([25, 25, 25], 100)), 100)

    def test_split_from_zero(self):
        self.assertEqual(apply_plan.split([0, 0], 50), [25, 25])


class PlanChanges(unittest.TestCase):
    def test_helios_two_campaigns(self):
        req = {"id": "r1", "channel_id": "Helios|A", "eur": 60, "status": "pending"}
        ch = apply_plan.plan_changes(req, [camp("eng", 30), camp("ret", 10)], MAPPING)
        self.assertEqual(ch, [{"entity_type": "campaign", "entity_id": "eng", "old": 30, "new": 45, "was_active": True},
                              {"entity_type": "campaign", "entity_id": "ret", "old": 10, "new": 15, "was_active": True}])

    def test_only_mapped_active(self):
        req = {"id": "r2", "channel_id": "Ciccio|A", "eur": 120, "status": "pending"}
        ch = apply_plan.plan_changes(req, [camp("s27", 60), camp("old", 20, status="PAUSED"), camp("x", 10)], MAPPING)
        self.assertEqual([c["entity_id"] for c in ch], ["s27"])
        self.assertEqual(ch[0]["new"], 120)

    def test_adset_level(self):
        req = {"id": "r3", "channel_id": "B612|A", "eur": 50, "status": "pending"}
        adsets = [{"id": "a1", "status": "ACTIVE", "daily_budget": 25}, {"id": "a2", "status": "ACTIVE", "daily_budget": 0},
                  {"id": "a3", "status": "PAUSED", "daily_budget": 13}]
        ch = apply_plan.plan_changes(req, [camp("merc", 25, level="adset", adsets=adsets)], MAPPING)
        self.assertEqual([(c["entity_type"], c["entity_id"], c["new"]) for c in ch], [("ad_set", "a1", 50)])

    def test_lifetime_budget_never_touched(self):
        req = {"id": "r5", "channel_id": "Helios|A", "eur": 60, "status": "pending"}
        ch = apply_plan.plan_changes(req, [camp("eng", 30), camp("ret", 0)], MAPPING)
        self.assertEqual([(c["entity_id"], c["new"]) for c in ch], [("eng", 60)])

    def test_idempotent(self):
        for status in ("applied", "superseded", "error"):
            req = {"id": "r4", "channel_id": "Helios|A", "eur": 60, "status": status}
            self.assertEqual(apply_plan.plan_changes(req, [camp("eng", 30)], MAPPING), [])


class AfterUpdate(unittest.TestCase):
    def test_reactivate_only_previously_active(self):
        changes = [{"entity_type": "campaign", "entity_id": "eng", "old": 30, "new": 45, "was_active": True},
                   {"entity_type": "campaign", "entity_id": "ret", "old": 10, "new": 15, "was_active": False}]
        readback = {"eng": {"status": "PAUSED", "daily_budget": 45}, "ret": {"status": "PAUSED", "daily_budget": 15}}
        out = apply_plan.after_update(changes, readback)
        self.assertEqual(out["reactivate"], ["eng"])
        self.assertTrue(out["ok"])

    def test_budget_not_applied_is_error(self):
        changes = [{"entity_type": "campaign", "entity_id": "eng", "old": 30, "new": 45, "was_active": True}]
        out = apply_plan.after_update(changes, {"eng": {"status": "ACTIVE", "daily_budget": 30}})
        self.assertFalse(out["ok"])
        self.assertIn("eng", out["message"])

    def test_message_lists_changes(self):
        changes = [{"entity_type": "campaign", "entity_id": "eng", "old": 30, "new": 45, "was_active": True}]
        out = apply_plan.after_update(changes, {"eng": {"status": "ACTIVE", "daily_budget": 45}})
        self.assertEqual(out["message"], "applicato: eng 30→45 €/g")


if __name__ == "__main__":
    unittest.main()


import hourly  # noqa: E402


class Hourly(unittest.TestCase):
    def test_accounts_for_requests(self):
        mapping = [{"account_id": "1", "campaign_id": "a", "channel_id": "Helios|A"},
                   {"account_id": "1", "campaign_id": "b", "channel_id": "Helios|A"},
                   {"account_id": "2", "campaign_id": "c", "channel_id": "Ciccio|A"},
                   {"account_id": "3", "campaign_id": "d", "channel_id": "Brora|A"}]
        reqs = [{"id": "r1", "channel_id": "Helios|A"}, {"id": "r2", "channel_id": "Ciccio|A"}]
        self.assertEqual(hourly.accounts_for_requests(reqs, mapping), {"1": "Helios", "2": "Ciccio"})


class TitleCheck(unittest.TestCase):
    """Review I1: una riga MAPPA con il titolo di un altro blocco non riceve il budget."""

    def test_rows_of_another_block_are_skipped(self):
        mapping = [{"campaign_id": "ita", "channel_id": "Cirillo|A", "channel_title": "BUDGET FACEBOOK ADS ITALIA"},
                   {"campaign_id": "est", "channel_id": "Cirillo|A", "channel_title": "BUDGET FACEBOOK ADS ESTERO"},
                   {"campaign_id": "old", "channel_id": "Cirillo|A"}]
        req = {"id": "r1", "channel_id": "Cirillo|A", "eur": 50, "status": "pending"}
        ch = apply_plan.plan_changes(req, [camp("ita", 30), camp("est", 20), camp("old", 10)], mapping,
                                     channel_title="BUDGET FACEBOOK ADS ESTERO")
        self.assertEqual(sorted(c["entity_id"] for c in ch), ["est", "old"])

