"""ChatGPT Ads nella routine notturna (11/11/2026): speso e clic del mese per il blocco "Color Holiday - Chatgpt ADS"."""
import datetime
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import chatgpt  # noqa: E402

# 00:00 ora di Roma del giorno indicato, come start_time delle righe giornaliere dell'API
def day_start(y, m, d):
    return int(datetime.datetime(y, m, d, tzinfo=chatgpt.ROME).timestamp())


def row(y, m, d, spend, clicks):
    return {"start_time": day_start(y, m, d), "end_time": day_start(y, m, d) + 86400, "spend": spend, "clicks": clicks, "impressions": 100}


class Period(unittest.TestCase):
    def test_from_first_of_month_to_yesterday(self):
        self.assertEqual(chatgpt.period(datetime.date(2026, 11, 11)), ("2026-11-01", "2026-11-10"))

    def test_first_of_month_closes_previous(self):
        self.assertEqual(chatgpt.period(datetime.date(2026, 12, 1)), ("2026-11-01", "2026-11-30"))
        self.assertEqual(chatgpt.period(datetime.date(2027, 1, 1)), ("2026-12-01", "2026-12-31"))


class Totals(unittest.TestCase):
    def test_only_days_in_period(self):
        rows = [row(2026, 11, 11, 1.81, 1), row(2026, 11, 10, 20.0, 8), row(2026, 11, 1, 18.5, 7), row(2026, 10, 31, 25.0, 9)]
        self.assertEqual(chatgpt.month_totals(rows, "2026-11-01", "2026-11-10"), (38.5, 15))

    def test_rome_day_not_utc(self):
        # 1 novembre 00:00 a Roma = 31 ottobre 23:00 UTC: il giorno è il 1 novembre
        self.assertEqual(chatgpt.month_totals([row(2026, 11, 1, 10.0, 2)], "2026-11-01", "2026-11-30"), (10.0, 2))

    def test_missing_values_count_zero(self):
        r = {"start_time": day_start(2026, 11, 2), "impressions": 5}
        self.assertEqual(chatgpt.month_totals([r], "2026-11-01", "2026-11-10"), (0.0, 0))


class Payload(unittest.TestCase):
    CH = {"channel_id": "Color Holiday - Chatgpt ADS|A", "title": "BUDGET CHATGPT ADS"}

    def test_payload_for_save_chatgpt(self):
        campaigns = [
            {"id": "c1", "status": "active", "budget": {"daily_spend_limit_micros": 25000000}},
            {"id": "c2", "status": "paused", "budget": {"daily_spend_limit_micros": 10000000}},
        ]
        insights = {"c1": [row(2026, 11, 3, 18.25, 6)], "c2": [row(2026, 11, 2, 4.0, 1)]}
        p = chatgpt.channel_payload(self.CH, campaigns, insights, "2026-11-01", "2026-11-10")
        self.assertEqual(p, {"channel_id": "Color Holiday - Chatgpt ADS|A", "title": "BUDGET CHATGPT ADS", "date": "2026-11-10",
                             "spent_mtd": 22.25, "leads_mtd": 7, "daily_budget": 25.0, "active": True})

    def test_all_paused(self):
        campaigns = [{"id": "c1", "status": "paused", "budget": {"daily_spend_limit_micros": 25000000}}]
        p = chatgpt.channel_payload(self.CH, campaigns, {"c1": []}, "2026-11-01", "2026-11-10")
        self.assertEqual((p["spent_mtd"], p["leads_mtd"], p["daily_budget"], p["active"]), (0.0, 0, 0.0, False))


class Paging(unittest.TestCase):
    def test_follows_after_until_no_more(self):
        pages = {None: {"data": [{"id": "a"}], "has_more": True, "last_id": "a"},
                 "a": {"data": [{"id": "b"}], "has_more": False, "last_id": "b"}}
        seen = []

        def get(path):
            after = path.split("after=")[1] if "after=" in path else None
            seen.append(after)
            return pages[after]
        self.assertEqual([r["id"] for r in chatgpt.all_insights(get, "c1")], ["a", "b"])
        self.assertEqual(seen, [None, "a"])


class ApiResponse(unittest.TestCase):
    def test_parse_body_and_status(self):
        self.assertEqual(chatgpt.parse_response('{"ok": 1}\nHTTP 200\n'), (200, {"ok": 1}))
        with self.assertRaises(RuntimeError):
            chatgpt.parse_response('{"error": {"message": "no"}}\nHTTP 401\n')


if __name__ == "__main__":
    unittest.main()
