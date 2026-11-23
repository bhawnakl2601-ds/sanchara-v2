"""Passenger incident reports. Reports are leads for review, never official alerts. Safeguards: honeypot, per-reporter rate limit, duplicate detection, upload validation."""
from __future__ import annotations
import hashlib, secrets, time, datetime as dt
from ..core.config import settings
from ..core.database import DB, utcnow
from .common import ApiError, need, clip
from .network import Network
from .lostfound import desc_sim

CATEGORIES = ['POSSIBLE_DELAY', 'UNEXPECTED_CROWDING', 'FACILITY_ISSUE', 'LIFT_ESCALATOR', 'LOST_ITEM', 'FOUND_ITEM', 'ASSISTANCE']
STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'RESOLVED']
SIGS = {b'\xff\xd8\xff': ('jpg', 'image/jpeg'), b'\x89PNG\r\n\x1a\n': ('png', 'image/png')}

def validate_image(data: bytes) -> str:
    if len(data) > settings.MAX_UPLOAD_BYTES: raise ApiError(413, f'image larger than {settings.MAX_UPLOAD_BYTES // 1024} KB')
    for sig, (ext, _) in SIGS.items():
        if data.startswith(sig): return ext
    raise ApiError(415, 'only JPEG or PNG images are accepted')     # content sniffing, not the client-supplied filename/type
def save_image(data: bytes) -> str:
    ext = validate_image(data); settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True); name = f'{secrets.token_hex(12)}.{ext}'; (settings.UPLOAD_DIR / name).write_bytes(data); return name

class Reports:
    def __init__(self, db: DB, net: Network): self.db, self.net = db, net; self._hits: dict[str, list[float]] = {}
    def _rate(self, key: str):
        now = time.time(); h = [t for t in self._hits.get(key, []) if now - t < 3600]
        if len(h) >= settings.REPORT_RATE_LIMIT_PER_HOUR: raise ApiError(429, 'too many reports from this device; please try again later')
        h.append(now); self._hits[key] = h
    def submit(self, user: dict | None, d: dict, reporter_key: str, image_path: str | None = None) -> dict:
        if d.get('website'): return dict(ref='RPT-OK', status='SUBMITTED')          # honeypot: silently drop bots, reveal nothing
        need(d, 'category', 'description')
        if d['category'] not in CATEGORIES: raise ApiError(422, f'category must be one of {CATEGORIES}')
        desc = clip(d['description'], 1000)
        if len(desc) < 10: raise ApiError(422, 'please describe the issue in at least 10 characters')
        st = d.get('station_id')
        if st and not self.net.valid_station(st): raise ApiError(422, 'unknown station')
        self._rate(hashlib.sha256((reporter_key + ':' + str(user['id'] if user else '')).encode()).hexdigest()[:16])
        # duplicate / grouping: same station+category in the last 3 hours and similar text -> same possible incident
        gid = None; dup = False
        cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=3)).isoformat(timespec='seconds')
        for r in self.db.q("SELECT id,group_id,description,reporter_key FROM passenger_reports WHERE station_id IS ? AND category=? AND created_at>? AND status!='REJECTED'", (st, d['category'], cutoff)):
            if r['reporter_key'] == reporter_key and desc_sim(r['description'], desc) > 0.8: dup = True
            gid = r['group_id'] or r['id']            # same station + category within 3h = one POSSIBLE incident (still unverified)
        if dup: raise ApiError(409, 'you already reported this recently')
        now = utcnow(); ref = 'RPT-' + secrets.token_hex(3).upper()
        rid = self.db.x('INSERT INTO passenger_reports(ref,user_id,reporter_key,category,station_id,description,image_path,status,group_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', (ref, user['id'] if user else None, reporter_key, d['category'], st, desc, image_path, 'SUBMITTED', gid, now, now))
        if gid: self.db.x('UPDATE passenger_reports SET group_id=? WHERE id=? AND group_id IS NULL', (gid, gid))
        return dict(id=rid, ref=ref, status='SUBMITTED', grouped=bool(gid), notice='Thanks. Reports are reviewed by staff and are not official service information.')
    def mine(self, user: dict) -> list[dict]: return self.db.q('SELECT ref,category,station_id,status,created_at FROM passenger_reports WHERE user_id=? ORDER BY id DESC', (user['id'],))
    def admin_list(self, status: str | None = None) -> list[dict]:
        rows = self.db.q('SELECT id,ref,category,station_id,description,image_path,status,group_id,admin_note,created_at FROM passenger_reports ' + ('WHERE status=? ' if status else '') + 'ORDER BY id DESC LIMIT 300', (status,) if status else ())
        cnt = {}
        for r in rows: cnt[r['group_id'] or r['id']] = cnt.get(r['group_id'] or r['id'], 0) + 1
        for r in rows: r['group_size'] = cnt[r['group_id'] or r['id']]; r['station_name'] = (self.net.stations.get(r['station_id'] or '') or {}).get('name')
        return rows
    def set_status(self, actor: dict, rid: int, status: str, note: str | None = None) -> dict:
        if status not in STATUSES[1:]: raise ApiError(422, f'status must be one of {STATUSES[1:]}')
        r = self.db.one('SELECT id,group_id FROM passenger_reports WHERE id=?', (rid,))
        if not r: raise ApiError(404, 'report not found')
        self.db.x('UPDATE passenger_reports SET status=?, admin_note=?, updated_at=? WHERE id=?', (status, clip(note, 500), utcnow(), rid)); self.db.audit(actor['id'], f'report.{status.lower()}', 'report', rid, dict(note=note)); return dict(id=rid, status=status)
    def merge(self, actor: dict, ids: list[int]) -> dict:
        if len(ids) < 2: raise ApiError(422, 'select at least two reports to merge')
        root = min(ids); self.db.conn.executemany('UPDATE passenger_reports SET group_id=? WHERE id=?', [(root, i) for i in ids]); self.db.conn.commit(); self.db.audit(actor['id'], 'report.merge', 'report', root, dict(ids=ids)); return dict(group_id=root, merged=ids)
    def public_summary(self) -> dict:
        """Counts only. The number of reports is never treated as proof of a disruption."""
        r = self.db.one("SELECT COUNT(*) n FROM passenger_reports WHERE status IN ('SUBMITTED','UNDER_REVIEW')"); return dict(under_review=r['n'], note='Passenger reports are unverified leads, not confirmed disruptions.')
