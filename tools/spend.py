"""Speso Meta del mese per canale, da scrivere nella colonna Spesa Effettiva dello Sheet."""


def spend_items(meta, mapping, channel_ids, yms):
    by_campaign = {str(r["campaign_id"]): r["channel_id"] for r in mapping if r.get("channel_id")}
    totals = {}
    for r in meta["daily"]:
        ch = by_campaign.get(str(r["campaign_id"]))
        ym = r["date"][:7]
        if ch in channel_ids and ym in yms:
            totals[(ch, ym)] = totals.get((ch, ym), 0.0) + r["spend"]
    return [{"channel_id": ch, "ym": ym, "value": round(totals[(ch, ym)], 2)}
            for ch in channel_ids for ym in yms if totals.get((ch, ym), 0) > 0]
