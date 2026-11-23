"""Central notification engine: relevance -> verification -> expiry -> preference -> dedupe/cooldown -> in-app row -> realtime hub -> optional push."""
from __future__ import annotations
import json, hashlib, queue, threading, datetime as dt
from ..core.config import settings
from ..core.database import DB, utcnow
from .common import ApiError

CATEGORIES = ['DELAY', 'ROUTE_CHANGE', 'STATION_CLOSURE', 'LINE_CLOSURE', 'CROWD_WARNING', 'EMERGENCY_INFORMATION', 'LOST_FOUND_UPDATE', 'FACILITY_ISSUE']
DEFAULT_PREFS = dict(categories={c: True for c in CATEGORIES}, crowd_min_level='HIGH', browser=False, push=False)
LEVEL_RANK = {'LOW': 0, 'MODERATE': 1, 'HIGH': 2, 'VERY HIGH': 3}

class Hub:
    """In-process fan-out for users currently connected (WebSocket in the FastAPI app; clients otherwise poll /api/notifications)."""
    def __init__(self): self.subs: dict[int, list[queue.Queue]] = {}; self.lock = threading.Lock()
    def subscribe(self, uid: int) -> queue.Queue:
        q = queue.Queue(maxsize=100)
        with self.lock: self.subs.setdefault(uid, []).append(q)
        return q
    def unsubscribe(self, uid: int, q): 
        with self.lock: self.subs.get(uid, []).remove(q) if q in self.subs.get(uid, []) else None
    def publish(self, uid: int, msg: dict):
        for q in list(self.subs.get(uid, [])):
            try: q.put_nowait(msg)
            except queue.Full: pass
hub = Hub()

class Notifier:
    def __init__(self, db: DB): self.db = db
    def prefs(self, uid: int) -> dict:
        r = self.db.one('SELECT prefs FROM notification_preferences WHERE user_id=?', (uid,))
        p = json.loads(r['prefs']) if r else {}
        return {**DEFAULT_PREFS, **p, 'categories': {**DEFAULT_PREFS['categories'], **p.get('categories', {})}}
    def set_prefs(self, uid: int, patch: dict, fcm_token: str | None = None) -> dict:
        cur = self.prefs(uid)
        if 'categories' in patch:
            bad = [k for k in patch['categories'] if k not in CATEGORIES]
            if bad: raise ApiError(422, f'unknown categories: {bad}')
            cur['categories'].update({k: bool(v) for k, v in patch['categories'].items()})
        if patch.get('crowd_min_level') in LEVEL_RANK: cur['crowd_min_level'] = patch['crowd_min_level']
        for k in ('browser', 'push'):
            if k in patch: cur[k] = bool(patch[k])
        self.db.x('INSERT INTO notification_preferences(user_id,prefs,fcm_token,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET prefs=excluded.prefs, fcm_token=COALESCE(excluded.fcm_token, fcm_token), updated_at=excluded.updated_at', (uid, json.dumps(cur), fcm_token, utcnow()))
        return cur
    # --- the single gate every module goes through -----------------------------------------------------------------------------
    def send(self, uid: int, category: str, title: str, body: str, *, key: str, verification: str, source_label: str, payload: dict | None = None,
             expires_at: str | None = None, cooldown_sec: int | None = None, force: bool = False) -> dict:
        if category not in CATEGORIES: raise ApiError(500, f'bad category {category}')
        if verification not in ('VERIFIED', 'OFFICIAL_FEED', 'MODEL_ESTIMATE', 'ADMIN'): return dict(sent=False, reason='source not verified')   # unverified never notifies
        if expires_at and expires_at <= utcnow(): return dict(sent=False, reason='expired')
        pr = self.prefs(uid)
        if not pr['categories'].get(category, True): return dict(sent=False, reason='category disabled by user')
        fam = hashlib.sha1(f'{category}|{key.split("#")[0]}'.encode()).hexdigest()[:8]          # same entity (e.g. one alert)
        dk = f'{fam}:' + hashlib.sha1(f'{category}|{key}'.encode()).hexdigest()[:12]            # same entity AND same content/version
        if self.db.one('SELECT 1 FROM notifications WHERE user_id=? AND dedupe_key=?', (uid, dk)): return dict(sent=False, reason='duplicate')
        cd = settings.NOTIFY_COOLDOWN_SEC if cooldown_sec is None else cooldown_sec
        if cd and not force:
            cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=cd)).isoformat(timespec='seconds')
            if self.db.one("SELECT 1 FROM notifications WHERE user_id=? AND dedupe_key LIKE ? AND created_at>?", (uid, fam + ':%', cutoff)): return dict(sent=False, reason='cooldown')
        delivery = ['in_app']
        if pr.get('push'):
            r = self.db.one('SELECT fcm_token FROM notification_preferences WHERE user_id=?', (uid,))
            delivery.append(push_status(r['fcm_token'] if r else None))
        nid = self.db.x('INSERT INTO notifications(user_id,category,title,body,payload,dedupe_key,source_label,verification_status,created_at,expires_at,delivery) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                        (uid, category, title, body, json.dumps(payload or {}), dk, source_label, verification, utcnow(), expires_at, ','.join(delivery)))
        hub.publish(uid, dict(id=nid, category=category, title=title, body=body))
        return dict(sent=True, id=nid, delivery=delivery)
    def list(self, uid: int, unread_only=False, limit=100) -> list[dict]:
        rows = self.db.q(f"SELECT * FROM notifications WHERE user_id=? {'AND read_at IS NULL' if unread_only else ''} ORDER BY id DESC LIMIT ?", (uid, limit))
        now = utcnow()
        for r in rows: r['payload'] = json.loads(r['payload'] or '{}'); r['expired'] = bool(r['expires_at'] and r['expires_at'] <= now)
        return rows
    def mark_read(self, uid: int, ids: list[int] | None): 
        if ids: self.db.conn.executemany('UPDATE notifications SET read_at=? WHERE user_id=? AND id=? AND read_at IS NULL', [(utcnow(), uid, i) for i in ids])
        else: self.db.conn.execute('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', (utcnow(), uid))
        self.db.conn.commit()
    # --- audiences ---------------------------------------------------------------------------------------------------------
    def audience(self, *, stations: list[str], line: str | None, kinds: tuple[str, ...]) -> set[int]:
        uids: set[int] = set()
        for r in self.db.q('SELECT user_id,kind,target FROM passenger_subscriptions'):
            if r['kind'] == 'station' and r['target'] in stations and ('station' in kinds): uids.add(r['user_id'])
            elif r['kind'] == 'line' and line and r['target'] == line and 'line' in kinds: uids.add(r['user_id'])
            elif r['kind'] in kinds and r['kind'] in ('delays', 'closures') and (not r['target'] or r['target'] == line): uids.add(r['user_id'])
        return uids

def push_status(token: str | None) -> str:
    """Firebase Cloud Messaging adapter. Not connected unless credentials are configured; never pretends delivery happened."""
    if not token: return 'push:no_device_token'
    if not (settings.FIREBASE_CREDENTIALS_JSON or settings.FCM_SERVER_KEY): return 'push:not_configured'
    try: import firebase_admin  # noqa
    except Exception: return 'push:firebase_admin_not_installed'
    return 'push:queued_unverified'    # sending requires an initialised Firebase app; see README. We only mark queued, never "delivered".
