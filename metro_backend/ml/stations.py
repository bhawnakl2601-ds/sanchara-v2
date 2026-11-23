"""Station mapping: ridership workbooks <-> BMRCL station codes <-> SANCHARA station ids.

Ridership files name stations like '11-Baiyappanahalli' (line digit + running number) and the matrix file uses
3-4 letter codes. The CSV maps codes to names but has several codes per station (spelling variants), so names are
NOT unique keys and codes are NOT unique per station. We therefore join by (a) the shared running order of the
ridership files and the matrix columns, then (b) verify every join by name similarity, and (c) record anything weak.
"""
from __future__ import annotations
import difflib, json, re
import pandas as pd
from .paths import RAW, METRO_JSON

def norm(s: str) -> str: return re.sub(r'[^a-z]', '', str(s).lower())

def read_code_csv() -> pd.DataFrame:
    """The supplied CSV has unquoted commas inside 4 station names, so split on the first comma only."""
    rows = []
    for i, line in enumerate(open(RAW/'station_codes.csv', encoding='utf-8')):
        if i == 0: continue
        line = line.rstrip('\r\n')
        if not line.strip(): continue
        code, name = line.split(',', 1)
        rows.append((code.strip(), name.strip()))
    return pd.DataFrame(rows, columns=['code', 'name'])

def hourly_id(station: str) -> str: return station.split('-', 1)[0]
def hourly_name(station: str) -> str: return station.split('-', 1)[1]
def id_sort_key(sid: str): return (int(sid[0]), int(sid[1:]))

# Hourly-file names that differ from the official name (renamed / abbreviated / misspelt in source). Reviewed manually.
HOURLY_NAME_OVERRIDES = {'224': 'Yelachenahalli', '113': 'Hosahalli', '16': 'Mahatma Gandhi Road', '12': 'Swami Vivekananda Road', '221': 'Rashtreeya Vidyalaya Road'}
# Matrix codes whose SANCHARA/GTFS id differs although the name is the same station (GTFS uses another spelling code).
MANUAL_SANCHARA = {'KRMA': 'KRAM'}

def build_mapping(hourly_stations: list[str], matrix_codes: list[str]) -> pd.DataFrame:
    csv = read_code_csv(); code2name = dict(zip(csv.code, csv.name))
    metro = json.load(open(METRO_JSON, encoding='utf-8'))['stations']
    by_norm: dict[str, list[str]] = {}
    for sid, st in metro.items(): by_norm.setdefault(norm(st['name']), []).append(sid)
    order = sorted({hourly_id(s): s for s in hourly_stations}.items(), key=lambda kv: id_sort_key(kv[0]))
    assert len(order) == len(matrix_codes), 'ridership station count must equal matrix column count'
    out = []
    for (hid, hs), code in zip(order, matrix_codes):
        hname = hourly_name(hs); official = code2name.get(code)
        a = norm(HOURLY_NAME_OVERRIDES.get(hid, hname)); b = norm(official or '')
        sim = difflib.SequenceMatcher(None, a, b).ratio()
        cand = by_norm.get(b, [])
        sid = MANUAL_SANCHARA.get(code) or (code if code in metro else (cand[0] if len(cand) == 1 else None))
        if sid is None:   # try contains (e.g. 'Whitefield (Kadugodi)')
            cand = [k for n, ks in by_norm.items() if n in b or b in n for k in ks]
            sid = cand[0] if len(cand) == 1 else None
        st = metro.get(sid) if sid else None
        aliases = sorted({c for c, n in code2name.items() if norm(n) == norm(official or '') and c != code})
        out.append(dict(hourly_station=hs, hourly_id=hid, matrix_code=code, official_name=official, hourly_name=hname,
                        name_similarity=round(sim, 2), sanchara_id=sid, display_name=(st or {}).get('name', official),
                        kn=(st or {}).get('kn'), lines=','.join((st or {}).get('lines', [])), lat=(st or {}).get('lat'), lon=(st or {}).get('lon'),
                        code_aliases=','.join(aliases), mapped_by='order+name' ))
    return pd.DataFrame(out)

def validate_mapping(m: pd.DataFrame) -> list[str]:
    w = []
    if m.sanchara_id.isna().any(): w.append(f"unmapped to SANCHARA: {m[m.sanchara_id.isna()].hourly_station.tolist()}")
    d = m[m.sanchara_id.notna() & m.sanchara_id.duplicated(keep=False)]
    if len(d): w.append(f"duplicate SANCHARA ids: {d.sanchara_id.tolist()}")
    weak = m[m.name_similarity < 0.8]
    if len(weak): w.append("weak name matches (verified by running order; review): " + '; '.join(f"{r.hourly_station} -> {r.official_name} ({r.name_similarity})" for r in weak.itertuples()))
    return w
