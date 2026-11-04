"""Speso Meta del mese per canale, da scrivere nella colonna Spesa Effettiva dello Sheet."""


def row_matches(row, channel_id, title):
    """Una riga MAPPA vale per il canale se ha il suo id e, quando c'e', lo stesso titolo del blocco."""
    return row.get("channel_id") == channel_id and (not row.get("channel_title") or not title
                                                    or row["channel_title"] == title)


def spend_items(meta, mapping, channels, yms):
    """channels: {channel_id: titolo del blocco}. Ogni voce porta il titolo, che la web app ricontrolla."""
    by_campaign = {}
    for r in mapping:
        ch = r.get("channel_id")
        if ch in channels and row_matches(r, ch, channels[ch]):
            by_campaign[str(r["campaign_id"])] = ch
    totals = {}
    for r in meta["daily"]:
        ch = by_campaign.get(str(r["campaign_id"]))
        ym = r["date"][:7]
        if ch and ym in yms:
            totals[(ch, ym)] = totals.get((ch, ym), 0.0) + r["spend"]
    return [{"channel_id": ch, "title": channels[ch], "ym": ym, "value": round(totals[(ch, ym)], 2)}
            for ch in channels for ym in yms if totals.get((ch, ym), 0) > 0]
