"""SQLite persistence (stdlib sqlite3) with a tiny migration runner. Timestamps are stored as UTC ISO-8601 text; the UI converts to Asia/Kolkata."""
from __future__ import annotations
import json, sqlite3, threading, datetime as dt
from pathlib import Path
from .config import settings, ROOT

def utcnow() -> str: return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')

MIGRATIONS: list[tuple[str, str]] = [('0001_initial', '''
CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('passenger','admin')), display_name TEXT, created_at TEXT NOT NULL);
CREATE TABLE metro_lines(id TEXT PRIMARY KEY, name TEXT, long_name TEXT, color TEXT);
CREATE TABLE stations(id TEXT PRIMARY KEY, name TEXT NOT NULL, kn TEXT, lat REAL, lon REAL, lines TEXT, interchange INTEGER, wheelchair INTEGER, hourly_id TEXT, matrix_code TEXT, official_name TEXT);
CREATE TABLE station_aliases(id INTEGER PRIMARY KEY, station_id TEXT NOT NULL REFERENCES stations(id), alias TEXT NOT NULL, source TEXT, UNIQUE(station_id, alias));
CREATE TABLE metro_edges(id INTEGER PRIMARY KEY, line_id TEXT NOT NULL REFERENCES metro_lines(id), from_station TEXT NOT NULL REFERENCES stations(id), to_station TEXT NOT NULL REFERENCES stations(id), km REAL, sec INTEGER, UNIQUE(line_id, from_station, to_station));
CREATE TABLE data_sources(id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, url TEXT, status TEXT NOT NULL, last_attempt TEXT, last_success TEXT, data_timestamp TEXT, stale_after_sec INTEGER, error TEXT, fallback_in_use INTEGER DEFAULT 0, notes TEXT, requires TEXT);
CREATE TABLE data_ingestion_logs(id INTEGER PRIMARY KEY, source_id TEXT REFERENCES data_sources(id), at TEXT NOT NULL, status TEXT, message TEXT);
CREATE TABLE closures(id INTEGER PRIMARY KEY, type TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('station','section','line','partial','interchange')), station_id TEXT REFERENCES stations(id), line_id TEXT REFERENCES metro_lines(id), from_station TEXT REFERENCES stations(id), to_station TEXT REFERENCES stations(id),
  reason TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT, status TEXT NOT NULL DEFAULT 'SCHEDULED', trains_pass_through INTEGER DEFAULT 1, source_id TEXT REFERENCES data_sources(id), source_url TEXT, source_note TEXT, extended_count INTEGER DEFAULT 0, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX ix_closures_status ON closures(status);
CREATE TABLE service_alerts(id INTEGER PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, description TEXT, line_id TEXT REFERENCES metro_lines(id), delay_minutes REAL, severity TEXT, reason TEXT, start_at TEXT NOT NULL, expected_end_at TEXT, last_updated_at TEXT NOT NULL,
  source_id TEXT REFERENCES data_sources(id), source_url TEXT, published_at TEXT, verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK(verification_status IN ('UNVERIFIED','VERIFIED','OFFICIAL_FEED')), status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RESOLVED','CANCELLED')),
  closure_id INTEGER REFERENCES closures(id), fingerprint TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL);
CREATE INDEX ix_alerts_status ON service_alerts(status, verification_status);
CREATE UNIQUE INDEX ux_alert_fp ON service_alerts(fingerprint) WHERE fingerprint IS NOT NULL AND status='ACTIVE';
CREATE TABLE affected_stations(alert_id INTEGER NOT NULL REFERENCES service_alerts(id) ON DELETE CASCADE, station_id TEXT NOT NULL REFERENCES stations(id), PRIMARY KEY(alert_id, station_id));
CREATE TABLE affected_segments(alert_id INTEGER NOT NULL REFERENCES service_alerts(id) ON DELETE CASCADE, line_id TEXT, from_station TEXT NOT NULL, to_station TEXT NOT NULL);
CREATE TABLE crowd_predictions(id INTEGER PRIMARY KEY, station_id TEXT NOT NULL REFERENCES stations(id), for_date TEXT NOT NULL, hour INTEGER NOT NULL, entries INTEGER, exits INTEGER, level TEXT, uncertainty TEXT, model_version TEXT, generated_at TEXT NOT NULL, UNIQUE(station_id, for_date, hour, model_version));
CREATE TABLE crowd_observations(id INTEGER PRIMARY KEY, station_id TEXT NOT NULL REFERENCES stations(id), observed_at TEXT NOT NULL, measure TEXT, value REAL, source TEXT);  -- empty: no real occupancy data exists
CREATE TABLE events(id INTEGER PRIMARY KEY, name TEXT NOT NULL, venue TEXT, event_date TEXT NOT NULL, start_time TEXT, end_time TEXT, expected_attendance INTEGER, nearby_stations TEXT, source_url TEXT, verification_status TEXT NOT NULL DEFAULT 'SCENARIO' CHECK(verification_status IN ('SCENARIO','UNVERIFIED','VERIFIED')), created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE emergency_contacts(id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, phone TEXT, email TEXT, description TEXT, source_url TEXT, verification_status TEXT NOT NULL, last_verified_at TEXT, sort INTEGER DEFAULT 100);
CREATE TABLE lost_items(id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, user_id INTEGER REFERENCES users(id), category TEXT NOT NULL, name TEXT NOT NULL, description TEXT, colour TEXT, brand TEXT, lost_on TEXT, lost_time TEXT, station_id TEXT REFERENCES stations(id), line_id TEXT, image_path TEXT, contact TEXT, status TEXT NOT NULL DEFAULT 'LOST_REPORTED', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE found_items(id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, user_id INTEGER REFERENCES users(id), category TEXT NOT NULL, description TEXT NOT NULL, colour TEXT, brand TEXT, station_id TEXT REFERENCES stations(id), found_at TEXT, image_path TEXT, handover_note TEXT, status TEXT NOT NULL DEFAULT 'FOUND_REPORTED', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE lost_found_matches(id INTEGER PRIMARY KEY, lost_id INTEGER NOT NULL REFERENCES lost_items(id), found_id INTEGER NOT NULL REFERENCES found_items(id), score REAL NOT NULL, breakdown TEXT, status TEXT NOT NULL DEFAULT 'POSSIBLE_MATCH', reviewed_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(lost_id, found_id));
CREATE TABLE lost_found_claims(id INTEGER PRIMARY KEY, match_id INTEGER NOT NULL REFERENCES lost_found_matches(id), claimant_user_id INTEGER REFERENCES users(id), proof TEXT, status TEXT NOT NULL DEFAULT 'CLAIM_PENDING', created_at TEXT NOT NULL);
CREATE TABLE lost_found_audit(id INTEGER PRIMARY KEY, entity TEXT NOT NULL, entity_id INTEGER NOT NULL, from_status TEXT, to_status TEXT, actor TEXT, note TEXT, at TEXT NOT NULL);
CREATE TABLE passenger_reports(id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, user_id INTEGER REFERENCES users(id), reporter_key TEXT, category TEXT NOT NULL, station_id TEXT REFERENCES stations(id), description TEXT NOT NULL, image_path TEXT, status TEXT NOT NULL DEFAULT 'SUBMITTED', group_id INTEGER, admin_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX ix_reports_status ON passenger_reports(status);
CREATE TABLE passenger_subscriptions(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('station','line','route','crowd','delays','closures')), target TEXT NOT NULL DEFAULT '', config TEXT, created_at TEXT NOT NULL, UNIQUE(user_id, kind, target));
CREATE TABLE saved_journeys(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), label TEXT, origin TEXT NOT NULL, destination TEXT NOT NULL, legs TEXT NOT NULL, fare REAL, duration_min REAL, affected INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE notification_preferences(user_id INTEGER PRIMARY KEY REFERENCES users(id), prefs TEXT NOT NULL, fcm_token TEXT, updated_at TEXT);
CREATE TABLE notifications(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL, title TEXT NOT NULL, body TEXT, payload TEXT, dedupe_key TEXT NOT NULL, source_label TEXT, verification_status TEXT, created_at TEXT NOT NULL, expires_at TEXT, read_at TEXT, delivery TEXT);
CREATE INDEX ix_notif_user ON notifications(user_id, created_at); CREATE INDEX ix_notif_key ON notifications(user_id, dedupe_key);
CREATE TABLE admin_audit_logs(id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT, at TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
''')]

class DB:
    """Thread-safe wrapper: one connection per thread, rows as dicts."""
    def __init__(self, url: str | None = None):
        url = url or settings.DATABASE_URL
        if not url.startswith('sqlite:///'): raise RuntimeError('This build supports SQLite only. For PostgreSQL see README "Moving to PostgreSQL".')
        self.path = url[len('sqlite:///'):]; self._local = threading.local()
        if self.path != ':memory:':
            try: Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            except OSError as e: raise RuntimeError(f'Cannot create the database folder for {self.path!r}: {e}. Set DATABASE_URL to a writable location.') from e
        self._mem = sqlite3.connect(':memory:', check_same_thread=False) if self.path == ':memory:' else None
        if self._mem: self._mem.row_factory = sqlite3.Row; self._mem.execute('PRAGMA foreign_keys=ON')
        try: self.migrate()
        except sqlite3.Error as e: raise RuntimeError(f'Cannot open or migrate the SQLite database at {self.path!r}: {e}. Check the path is writable and the file is a SQLite database.') from e
    @property
    def conn(self) -> sqlite3.Connection:
        if self._mem: return self._mem
        c = getattr(self._local, 'c', None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=15); c.row_factory = sqlite3.Row; c.execute('PRAGMA foreign_keys=ON'); c.execute('PRAGMA journal_mode=WAL'); self._local.c = c
        return c
    def migrate(self):
        c = self.conn; c.execute('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY, at TEXT)')
        done = {r[0] for r in c.execute('SELECT name FROM _migrations')}
        for name, sql in MIGRATIONS:
            if name not in done:
                c.executescript(sql)
                c.execute('INSERT INTO _migrations VALUES(?,?)', (name, utcnow())); c.commit()
    def q(self, sql, args=()) -> list[dict]: return [dict(r) for r in self.conn.execute(sql, args).fetchall()]
    def one(self, sql, args=()) -> dict | None: r = self.conn.execute(sql, args).fetchone(); return dict(r) if r else None
    def x(self, sql, args=()) -> int:
        cur = self.conn.execute(sql, args); self.conn.commit(); return cur.lastrowid
    def many(self, sql, rows): self.conn.executemany(sql, rows); self.conn.commit()
    def audit(self, actor_id, action, entity=None, entity_id=None, detail=None):
        self.x('INSERT INTO admin_audit_logs(actor_id,action,entity,entity_id,detail,at) VALUES(?,?,?,?,?,?)', (actor_id, action, entity, str(entity_id) if entity_id is not None else None, json.dumps(detail, default=str) if detail is not None else None, utcnow()))
