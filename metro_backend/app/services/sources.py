"""Data-source health registry. States: CONNECTED, STALE, UNAVAILABLE, AUTH_REQUIRED, ERROR, MANUAL_SOURCE. A cached schedule or historical dataset is never labelled live."""
from __future__ import annotations
import datetime as dt, json
from ..core.config import settings
from ..core.database import DB, utcnow
from ..integrations.bmrcl import BmrclAlerts, BmrclTrips, BmrclVehicles, Bmtc, OpenCity
from .common import ApiError

LIVE_IDS = ('bmrcl_gtfs_rt_alerts', 'bmrcl_gtfs_rt_trips', 'bmrcl_gtfs_rt_vehicles')
NOT_LIVE_MSG = 'Live BMRCL feed not connected. Showing the latest verified information available.'

class Sources:
    def __init__(self, db: DB, predictor=None): self.db, self.pred = db, predictor
    def _log(self, sid, status, msg): self.db.x('INSERT INTO data_ingestion_logs(source_id,at,status,message) VALUES(?,?,?,?)', (sid, utcnow(), status, msg[:300]))
    def record(self, sid: str, status: str, msg: str = '', data_ts: str | None = None):
        now = utcnow(); self.db.x('UPDATE data_sources SET status=?, last_attempt=?, last_success=CASE WHEN ?="CONNECTED" THEN ? ELSE last_success END, data_timestamp=COALESCE(?,data_timestamp), error=? WHERE id=?', (status, now, status, now, data_ts, msg if status not in ('CONNECTED',) else None, sid)); self._log(sid, status, msg)
    def refresh(self) -> list[dict]:
        """One refresh pass. Safe to run on a schedule; unconfigured adapters report AUTH_REQUIRED without any network call."""
        out = []
        for ad in (BmrclAlerts(), BmrclTrips(), BmrclVehicles(), Bmtc(), OpenCity()):
            r = ad.fetch() if not hasattr(ad, 'entities') else ad.entities()[0]
            self.record(ad.source_id, r.status, r.message, r.data_timestamp); out.append(dict(source=ad.source_id, status=r.status, message=r.message))
        if self.pred is not None:
            st = self.pred.status(); self.record('crowd_model', 'MANUAL_SOURCE' if st['model_loaded'] else 'ERROR', f"model {st.get('model_version')} (trained offline on historical data)" if st['model_loaded'] else f"model not loaded: {st['error']}", st.get('data_through'))
            self.db.x('UPDATE data_sources SET fallback_in_use=? WHERE id=?', (0 if st['model_loaded'] else 1, 'crowd_model'))
        return out
    def _effective(self, r: dict) -> dict:
        r = dict(r)
        if r['status'] == 'CONNECTED' and r['last_success'] and (r['stale_after_sec'] or 0) > 0:
            age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(r['last_success'])).total_seconds(); r['freshness_sec'] = int(age)
            if age > r['stale_after_sec']: r['status'] = 'STALE'
        r['is_live'] = r['id'] in LIVE_IDS and r['status'] == 'CONNECTED'
        return r
    def list(self) -> list[dict]: return [self._effective(r) for r in self.db.q('SELECT * FROM data_sources ORDER BY id')]
    def live_status(self) -> dict:
        s = [x for x in self.list() if x['id'] in LIVE_IDS]; live = any(x['status'] == 'CONNECTED' for x in s)
        return dict(live_connected=live, message=None if live else NOT_LIVE_MSG, sources=[dict(id=x['id'], status=x['status']) for x in s])
    def logs(self, sid: str | None = None, limit=100) -> list[dict]: return self.db.q('SELECT * FROM data_ingestion_logs ' + ('WHERE source_id=? ' if sid else '') + 'ORDER BY id DESC LIMIT ?', (sid, limit) if sid else (limit,))
    def mark_verified(self, actor: dict, sid: str, note: str) -> dict:
        """For MANUAL sources: an admin records that they checked the source (e.g. the BMRCL contact page)."""
        if not self.db.one('SELECT 1 FROM data_sources WHERE id=?', (sid,)): raise ApiError(404, 'unknown source')
        self.db.x("UPDATE data_sources SET last_success=?, last_attempt=?, error=NULL WHERE id=?", (utcnow(), utcnow(), sid)); self._log(sid, 'MANUAL_VERIFIED', note or 'verified by admin'); self.db.audit(actor['id'], 'source.verify', 'source', sid, dict(note=note)); return dict(id=sid)
