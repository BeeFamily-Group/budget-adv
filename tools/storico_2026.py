"""Divisione mese per mese del 2026 dal vecchio foglio "_BUDGET CLIENTI", con le stesse righe e colonne del generatore 2027."""
# Uso: python3 tools/storico_2026.py "<BUDGET 2027>/build_budget_2027.py" "<_BUDGET CLIENTI>.xlsx" docs/data/storico-2026.json (poi ripulire il JSON come nel commit del 09/11)
import sys, io, json, contextlib
from openpyxl.utils import column_index_from_string as CI
GEN, REF, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(GEN, encoding='utf-8').read()
hook = '''
_orig_channel = channel
def channel(title, kind, sheet, col, rng, spesa_off=4, src26=None, **kw):
    out = _orig_channel(title, kind, sheet, col, rng, spesa_off=spesa_off, src26=src26, **kw)
    out['_src'] = (sheet, col, rng, spesa_off, src26)
    return out
FB, GG, GAS, EST = "meta", "google", "gas", "estero"
'''
assert src.count('FB, GG, GAS, EST = "meta", "google", "gas", "estero"') == 1
src = src.replace('FB, GG, GAS, EST = "meta", "google", "gas", "estero"', hook)
ns = {'__name__': 'gen'}
sys.argv = [GEN, REF, '/dev/null', '--dry']
with contextlib.redirect_stdout(io.StringIO()):
    try:
        exec(compile(src, GEN, 'exec'), ns)
    except SystemExit:
        pass
ref, num, find_months = ns['ref'], ns['num'], ns['find_months']
out = {}
for nome, tab, chs, nota in ns['CLIENTI']:
    for ch in chs:
        sheet, col, rng, off, src26 = ch['_src']
        ws = ref[sheet]
        c = CI(col) if isinstance(col, str) else col
        rows = src26 if (src26 and sheet != 'Helios') else find_months(ws, c, *rng)
        months = {}
        for m, r in sorted(rows.items()):
            months[f"2026-{m:02d}"] = {'programmed': num(ws.cell(r, c + 3).value), 'spent': num(ws.cell(r, c + off).value)}
        out.setdefault(tab, {})[ch['title']] = {'months': months, 'p26': ch['p26'], 's26': ch['s26'], 'src': [sheet, str(col), list(rng), off]}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
for tab, chans in out.items():
    for title, d in chans.items():
        sp = sum(v['spent'] or 0 for v in d['months'].values()); pr = sum(v['programmed'] or 0 for v in d['months'].values())
        print(f"{tab:22} {title:30} mesi {len(d['months']):2}  prog {pr:9.0f} / p26 {d['p26'] or 0:9.0f}   speso {sp:9.0f} / s26 {d['s26'] or 0:9.0f}")
