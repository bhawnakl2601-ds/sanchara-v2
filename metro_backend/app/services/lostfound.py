"""Lost & found: SANCHARA's own database (BMRCL publishes no public lost-item database) with weighted, configurable text matching.
Matches are always 'Possible match'; an administrator must verify before details are revealed or a handover approved. Image matching is not implemented."""
from __future__ import annotations
import difflib, json, math, re, secrets, datetime as dt
from ..core.database import DB, utcnow
from .common import ApiError, need, clip, parse_ts
from .network import Network

CATEGORIES = ['bag', 'wallet', 'phone', 'laptop', 'keys', 'id_card', 'documents', 'clothing', 'umbrella', 'water_bottle', 'headphones', 'spectacles', 'jewellery', 'other']
RELATED = [{'bag', 'wallet', 'documents', 'id_card'}, {'phone', 'laptop', 'headphones'}, {'umbrella', 'clothing'}]
COLOUR_FAMILY = {'black': 'dark', 'grey': 'dark', 'gray': 'dark', 'navy': 'blue', 'blue': 'blue', 'red': 'red', 'maroon': 'red', 'brown': 'brown', 'tan': 'brown', 'beige': 'brown', 'green': 'green', 'white': 'light', 'silver': 'light', 'cream': 'light', 'yellow': 'yellow', 'orange': 'yellow', 'pink': 'pink', 'purple': 'pink', 'gold': 'yellow'}
STOP = set('a an the of and or with in on at to is was it my this that for from has have had black blue red green white lost found item'.split())
DEFAULT_WEIGHTS = dict(category=.25, description=.25, colour=.15, brand=.05, location=.15, time=.15)
THRESHOLD = 0.5
FLOW = {'POSSIBLE_MATCH': {'UNDER_REVIEW', 'VERIFIED_MATCH', 'CLOSED'}, 'UNDER_REVIEW': {'VERIFIED_MATCH', 'CLOSED'}, 'VERIFIED_MATCH': {'CLAIM_PENDING', 'CLOSED'}, 'CLAIM_PENDING': {'RETURNED', 'VERIFIED_MATCH', 'CLOSED'}, 'RETURNED': {'CLOSED'}, 'CLOSED': set()}

def tokens(text: str) -> list[str]:
    t = re.findall(r'[a-z0-9]+', (text or '').lower()); return [w[:-1] if len(w) > 3 and w.endswith('s') else w for w in t if w not in STOP and len(w) > 1]
def desc_sim(a: str, b: str) -> float:
    A, B = tokens(a), tokens(b)
    if not A or not B: return 0.0
    matched = 0.0
    for w in set(A):
        best = max((difflib.SequenceMatcher(None, w, x).ratio() for x in set(B)), default=0)
        matched += best if best >= 0.8 else 0
    return matched / len(set(A) | set(B))
def km(a, b) -> float:
    R = 6371; p1, p2 = math.radians(a[0]), math.radians(b[0]); d = math.radians(b[1] - a[1]); h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(d / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def score(lost: dict, found: dict, net: Network, w: dict | None = None) -> tuple[float, dict]:
    w = {**DEFAULT_WEIGHTS, **(w or {})}; parts: dict[str, float | None] = {}
    c1, c2 = lost['category'], found['category']
    parts['category'] = 1.0 if c1 == c2 else 0.4 if any(c1 in g and c2 in g for g in RELATED) else 0.0
    parts['description'] = desc_sim(f"{lost['name']} {lost.get('description') or ''}", found['description'])
    a, b = (lost.get('colour') or '').lower().strip(), (found.get('colour') or '').lower().strip()
    parts['colour'] = None if not a or not b else 1.0 if a == b else 0.6 if COLOUR_FAMILY.get(a) and COLOUR_FAMILY.get(a) == COLOUR_FAMILY.get(b) else 0.0
    a, b = (lost.get('brand') or '').lower().strip(), (found.get('brand') or '').lower().strip()
    parts['brand'] = None if not a or not b else difflib.SequenceMatcher(None, a, b).ratio() if difflib.SequenceMatcher(None, a, b).ratio() >= 0.8 else 0.0
    s1, s2 = net.stations.get(lost.get('station_id') or ''), net.stations.get(found.get('station_id') or '')
    if s1 and s2: d = 0 if s1 is s2 else km((s1['lat'], s1['lon']), (s2['lat'], s2['lon'])); parts['location'] = 1.0 if d == 0 else max(0.0, 1 - d / 12)
    else: parts['location'] = None
    try:
        lt = dt.datetime.fromisoformat(f"{lost['lost_on']}T{lost.get('lost_time') or '00:00'}"); ft = dt.datetime.fromisoformat(found['found_at'].replace('Z', '')).replace(tzinfo=None)
        hrs = (ft - lt).total_seconds() / 3600; parts['time'] = 0.0 if hrs < -3 else math.exp(-max(hrs, 0) / 72)      # found before it was lost (beyond tolerance) is impossible
    except Exception: parts['time'] = None
    used = {k: v for k, v in parts.items() if v is not None}; tw = sum(w[k] for k in used)
    total = sum(w[k] * v for k, v in used.items()) / tw if tw else 0.0
    if parts['category'] == 0.0: total *= 0.3          # hard penalty: different kind of object
    return round(total, 3), {k: (None if v is None else round(v, 2)) for k, v in parts.items()}

class LostFound:
    def __init__(self, db: DB, net: Network, notifier=None): self.db, self.net, self.n = db, net, notifier
    def weights(self) -> dict:
        r = self.db.one("SELECT value FROM settings WHERE key='lf_weights'"); return {**DEFAULT_WEIGHTS, **(json.loads(r['value']) if r else {})}
    def set_weights(self, actor: dict, w: dict) -> dict:
        bad = [k for k in w if k not in DEFAULT_WEIGHTS or not isinstance(w[k], (int, float)) or w[k] < 0]
        if bad: raise ApiError(422, f'invalid weights: {bad}')
        self.db.x("INSERT INTO settings VALUES('lf_weights',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps({**self.weights(), **w}),)); self.db.audit(actor['id'], 'lf.weights', 'settings', 'lf_weights', w); return self.weights()
    def _audit(self, entity, eid, frm, to, actor, note=None): self.db.x('INSERT INTO lost_found_audit(entity,entity_id,from_status,to_status,actor,note,at) VALUES(?,?,?,?,?,?,?)', (entity, eid, frm, to, actor, clip(note, 500), utcnow()))
    def _common(self, d: dict) -> dict:
        need(d, 'category'); 
        if d['category'] not in CATEGORIES: raise ApiError(422, f'category must be one of {CATEGORIES}')
        st = d.get('station_id'); 
        if st and not self.net.valid_station(st): raise ApiError(422, 'unknown station')
        return dict(category=d['category'], colour=clip(d.get('colour'), 30), brand=clip(d.get('brand'), 60), station_id=st)
    def submit_lost(self, user: dict | None, d: dict, image_path=None) -> dict:
        need(d, 'name', 'lost_on'); c = self._common(d); now = utcnow(); ref = 'LST-' + secrets.token_hex(3).upper()
        try: dt.date.fromisoformat(d['lost_on'])
        except ValueError: raise ApiError(422, 'lost_on must be YYYY-MM-DD')
        line = (self.net.stations[c['station_id']]['lines'][0] if c['station_id'] else d.get('line_id'))
        iid = self.db.x('INSERT INTO lost_items(ref,user_id,category,name,description,colour,brand,lost_on,lost_time,station_id,line_id,image_path,contact,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (ref, user['id'] if user else None, c['category'], clip(d['name'], 100), clip(d.get('description'), 1000), c['colour'], c['brand'], d['lost_on'], clip(d.get('lost_time'), 5), c['station_id'], line, image_path, clip(d.get('contact'), 120), 'LOST_REPORTED', now, now))
        self._audit('lost', iid, None, 'LOST_REPORTED', f"user:{user['id']}" if user else 'anonymous'); self.match_lost(iid); return self.public_lost(iid)
    def submit_found(self, user: dict | None, d: dict, image_path=None) -> dict:
        need(d, 'description', 'found_at'); c = self._common(d); now = utcnow(); ref = 'FND-' + secrets.token_hex(3).upper()
        fa = parse_ts(d['found_at'], 'found_at')
        iid = self.db.x('INSERT INTO found_items(ref,user_id,category,description,colour,brand,station_id,found_at,image_path,handover_note,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (ref, user['id'] if user else None, c['category'], clip(d['description'], 1000), c['colour'], c['brand'], c['station_id'], fa, image_path, None, 'FOUND_REPORTED', now, now))
        self._audit('found', iid, None, 'FOUND_REPORTED', f"user:{user['id']}" if user else 'anonymous'); self.match_found(iid); return dict(id=iid, ref=ref, status='FOUND_REPORTED')
    def _lost_for_match(self, r): return {**r, 'station_id': r['station_id']}
    def _store(self, lost: dict, found: dict):
        # found.found_at is UTC ISO; convert to IST wall-clock to compare with the passenger's local lost date/time
        f = {**found}
        try: f['found_at'] = (dt.datetime.fromisoformat(found['found_at']).astimezone(dt.timezone(dt.timedelta(hours=5, minutes=30)))).replace(tzinfo=None).isoformat()
        except Exception: pass
        s, parts = score(lost, f, self.net, self.weights())
        if s >= THRESHOLD and not self.db.one('SELECT 1 FROM lost_found_matches WHERE lost_id=? AND found_id=?', (lost['id'], found['id'])):
            now = utcnow(); self.db.x('INSERT INTO lost_found_matches(lost_id,found_id,score,breakdown,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', (lost['id'], found['id'], s, json.dumps(parts), 'POSSIBLE_MATCH', now, now))
            for tbl, i in (('lost_items', lost['id']), ('found_items', found['id'])):
                self.db.x(f"UPDATE {tbl} SET status='POSSIBLE_MATCH', updated_at=? WHERE id=? AND status IN ('LOST_REPORTED','FOUND_REPORTED')", (now, i))
            return True
        return False
    def match_lost(self, lid: int) -> int:
        lost = self.db.one('SELECT * FROM lost_items WHERE id=?', (lid,)); n = 0
        for f in self.db.q("SELECT * FROM found_items WHERE status IN ('FOUND_REPORTED','POSSIBLE_MATCH')"): n += int(self._store(lost, f))
        return n
    def match_found(self, fid: int) -> int:
        found = self.db.one('SELECT * FROM found_items WHERE id=?', (fid,)); n = 0
        for l in self.db.q("SELECT * FROM lost_items WHERE status IN ('LOST_REPORTED','POSSIBLE_MATCH')"): n += int(self._store(l, found))
        return n
    # --- views: passengers never see contact data, handover location, or the found description before admin verification -------------------
    def public_lost(self, lid: int) -> dict:
        r = self.db.one('SELECT ref,category,name,colour,brand,lost_on,lost_time,station_id,status,created_at FROM lost_items WHERE id=?', (lid,))
        if not r: raise ApiError(404, 'not found')
        return {**r, 'id': lid, 'station_name': (self.net.stations.get(r['station_id'] or '') or {}).get('name')}
    def my_matches(self, user: dict) -> list[dict]:
        rows = self.db.q('SELECT m.*, l.ref lost_ref, l.name lost_name, f.category fcat, f.colour fcolour, f.station_id fstation, f.found_at, f.description fdesc, f.handover_note FROM lost_found_matches m JOIN lost_items l ON l.id=m.lost_id JOIN found_items f ON f.id=m.found_id WHERE l.user_id=? ORDER BY m.score DESC', (user['id'],))
        out = []
        for r in rows:
            revealed = r['status'] in ('VERIFIED_MATCH', 'CLAIM_PENDING', 'RETURNED')
            out.append(dict(id=r['id'], lost_ref=r['lost_ref'], lost_name=r['lost_name'], status=r['status'], label='Possible match' if r['status'] in ('POSSIBLE_MATCH', 'UNDER_REVIEW') else r['status'].replace('_', ' ').title(), score=r['score'],
                            found_category=r['fcat'], found_colour=r['fcolour'], found_station=(self.net.stations.get(r['fstation'] or '') or {}).get('name'),
                            found_description=r['fdesc'] if revealed else None, handover_note=r['handover_note'] if r['status'] in ('CLAIM_PENDING', 'RETURNED') else None))
        return out
    def my_lost(self, user: dict) -> list[dict]: return [self.public_lost(r['id']) for r in self.db.q('SELECT id FROM lost_items WHERE user_id=? ORDER BY id DESC', (user['id'],))]
    def admin_matches(self) -> list[dict]:
        rows = self.db.q('SELECT m.*, l.ref lost_ref, l.name lost_name, l.description ldesc, l.contact, l.station_id lst, l.lost_on, f.ref found_ref, f.description fdesc, f.station_id fst, f.found_at, f.handover_note FROM lost_found_matches m JOIN lost_items l ON l.id=m.lost_id JOIN found_items f ON f.id=m.found_id ORDER BY m.score DESC')
        for r in rows: r['breakdown'] = json.loads(r['breakdown'] or '{}'); r['lost_station'] = (self.net.stations.get(r['lst'] or '') or {}).get('name'); r['found_station'] = (self.net.stations.get(r['fst'] or '') or {}).get('name')
        return rows
    def admin_items(self) -> dict:
        return dict(lost=self.db.q('SELECT * FROM lost_items ORDER BY id DESC LIMIT 200'), found=self.db.q('SELECT * FROM found_items ORDER BY id DESC LIMIT 200'), matches=self.admin_matches(), claims=self.db.q('SELECT * FROM lost_found_claims ORDER BY id DESC'))
    def history(self, entity: str, eid: int) -> list[dict]: return self.db.q('SELECT * FROM lost_found_audit WHERE entity=? AND entity_id=? ORDER BY id', (entity, eid))
    def transition(self, actor: dict, mid: int, to: str, note: str | None = None, handover_note: str | None = None) -> dict:
        m = self.db.one('SELECT * FROM lost_found_matches WHERE id=?', (mid,))
        if not m: raise ApiError(404, 'match not found')
        if to not in FLOW.get(m['status'], set()): raise ApiError(409, f"cannot move {m['status']} -> {to}")
        now = utcnow(); self.db.x('UPDATE lost_found_matches SET status=?, reviewed_by=?, updated_at=? WHERE id=?', (to, actor['id'], now, mid))
        false_match = to == 'CLOSED' and m['status'] in ('POSSIBLE_MATCH', 'UNDER_REVIEW')    # rejected suggestion: both items go back to the open pool
        for tbl, i, back in (('lost_items', m['lost_id'], 'LOST_REPORTED'), ('found_items', m['found_id'], 'FOUND_REPORTED')):
            self.db.x(f'UPDATE {tbl} SET status=?, updated_at=? WHERE id=?', (back if false_match else to, now, i))
        if handover_note is not None: self.db.x('UPDATE found_items SET handover_note=? WHERE id=?', (clip(handover_note, 500), m['found_id']))
        self._audit('match', mid, m['status'], to, f"admin:{actor['id']}", note); self.db.audit(actor['id'], f'lf.{to.lower()}', 'match', mid, dict(note=note))
        lost = self.db.one('SELECT user_id,ref FROM lost_items WHERE id=?', (m['lost_id'],))
        if self.n and lost and lost['user_id'] and to in ('UNDER_REVIEW', 'VERIFIED_MATCH', 'RETURNED', 'CLOSED'):
            self.n.send(lost['user_id'], 'LOST_FOUND_UPDATE', f"Lost item {lost['ref']}: {to.replace('_', ' ').title()}", 'Open Lost & Found to see the update.', key=f"match{mid}#{to}", verification='ADMIN', source_label='SANCHARA administrator', payload=dict(match_id=mid), force=True)
        return self.db.one('SELECT * FROM lost_found_matches WHERE id=?', (mid,))
    def claim(self, user: dict, mid: int, proof: str) -> dict:
        m = self.db.one('SELECT m.*, l.user_id FROM lost_found_matches m JOIN lost_items l ON l.id=m.lost_id WHERE m.id=?', (mid,))
        if not m or m['user_id'] != user['id']: raise ApiError(404, 'match not found')
        if m['status'] != 'VERIFIED_MATCH': raise ApiError(409, 'a claim can only be made after an administrator has verified the match')
        if not proof or len(proof.strip()) < 10: raise ApiError(422, 'describe something only the owner would know (min 10 characters)')
        self.db.x('INSERT INTO lost_found_claims(match_id,claimant_user_id,proof,status,created_at) VALUES(?,?,?,?,?)', (mid, user['id'], clip(proof, 800), 'CLAIM_PENDING', utcnow()))
        now = utcnow(); self.db.x("UPDATE lost_found_matches SET status='CLAIM_PENDING', updated_at=? WHERE id=?", (now, mid))
        for tbl, i in (('lost_items', m['lost_id']), ('found_items', m['found_id'])): self.db.x(f"UPDATE {tbl} SET status='CLAIM_PENDING', updated_at=? WHERE id=?", (now, i))
        self._audit('match', mid, 'VERIFIED_MATCH', 'CLAIM_PENDING', f"user:{user['id']}", 'claim submitted'); return dict(id=mid, status='CLAIM_PENDING')
    def reject_report(self, actor: dict, kind: str, iid: int, note: str) -> dict:
        tbl = 'lost_items' if kind == 'lost' else 'found_items'; r = self.db.one(f'SELECT status FROM {tbl} WHERE id=?', (iid,))
        if not r: raise ApiError(404, 'report not found')
        self.db.x(f"UPDATE {tbl} SET status='CLOSED', updated_at=? WHERE id=?", (utcnow(), iid)); self._audit(kind, iid, r['status'], 'CLOSED', f"admin:{actor['id']}", note or 'rejected'); self.db.audit(actor['id'], 'lf.reject', kind, iid, dict(note=note)); return dict(id=iid, status='CLOSED')
