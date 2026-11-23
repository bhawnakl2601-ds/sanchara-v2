"""Idempotent seeding: stations/lines/edges from the SAME metro.json the route planner uses (no second station database), emergency contacts, data-source registry, admin user."""
from __future__ import annotations
import json, csv, datetime as dt
from .core.config import settings, ROOT
from .core.database import DB, utcnow
from .core.security import hash_password

METRO = ROOT/'metro_frontend'/'src'/'data'/'metro.json'; MAPPING = ROOT/'data'/'metro'/'metadata'/'station_mapping.csv'

def seed_network(db: DB):
    if db.one('SELECT 1 FROM stations LIMIT 1'): return
    m = json.load(open(METRO, encoding='utf-8'))
    lines = list(m['lines'].values()) if isinstance(m['lines'], dict) else m['lines']
    for l in lines: db.x('INSERT OR IGNORE INTO metro_lines VALUES(?,?,?,?)', (l['id'], l['name'], l['longName'], l['color']))
    mp = {}
    if MAPPING.exists():
        for r in csv.DictReader(open(MAPPING, encoding='utf-8')): mp[r['sanchara_id']] = r
    for sid, s in m['stations'].items():
        r = mp.get(sid, {})
        db.x('INSERT OR IGNORE INTO stations VALUES(?,?,?,?,?,?,?,?,?,?,?)', (sid, s['name'], s.get('kn'), s['lat'], s['lon'], ','.join(s['lines']), int(s['interchange']), int(s.get('wheelchair', True)), r.get('hourly_id'), r.get('matrix_code'), r.get('official_name')))
        for a in s.get('aliases', []): db.x('INSERT OR IGNORE INTO station_aliases(station_id,alias,source) VALUES(?,?,?)', (sid, a, 'metro.json'))
        for a in (r.get('code_aliases') or '').split(','):
            if a: db.x('INSERT OR IGNORE INTO station_aliases(station_id,alias,source) VALUES(?,?,?)', (sid, a, 'station_codes.csv'))
        if r.get('official_name') and r['official_name'] != s['name']: db.x('INSERT OR IGNORE INTO station_aliases(station_id,alias,source) VALUES(?,?,?)', (sid, r['official_name'], 'station_codes.csv'))
    for l in lines:
        for g in l['segments']: db.x('INSERT OR IGNORE INTO metro_edges(line_id,from_station,to_station,km,sec) VALUES(?,?,?,?,?)', (l['id'], g['from'], g['to'], g['km'], g['sec']))

CONTACTS = [  # supplied by the project owner; shown with an explicit "verify periodically" status until an admin records verification
    ('National Emergency Response (ERSS)', 'EMERGENCY', '112', None, 'Single emergency number for police, fire and ambulance in India. For immediate danger call this first.', 'https://112.gov.in/', 1),
    ('BMRCL Passenger Helpline', 'BMRCL', '1800-425-12345', None, 'Namma Metro toll-free passenger helpline.', 'https://english.bmrc.co.in/contact-us/', 2),
    ('BMRCL Travel Enquiry', 'BMRCL', '080-25191091', None, 'Travel enquiries.', 'https://english.bmrc.co.in/contact-us/', 3),
    ('BMRCL Travel Help (email)', 'BMRCL', None, 'travelhelp@bmrc.co.in', 'Email for travel help and lost-property referrals.', 'https://english.bmrc.co.in/contact-us/', 4),
]
def seed_contacts(db: DB):
    if db.one('SELECT 1 FROM emergency_contacts LIMIT 1'): return
    for n, k, ph, em, d, u, s in CONTACTS: db.x('INSERT INTO emergency_contacts(name,kind,phone,email,description,source_url,verification_status,last_verified_at,sort) VALUES(?,?,?,?,?,?,?,?,?)', (n, k, ph, em, d, u, 'PROVIDED_NOT_YET_VERIFIED_BY_ADMIN', None, s))

SOURCES = [  # (id, name, type, url, status, stale_after, requires, notes)
    ('bmrcl_gtfs_static', 'BMRCL static GTFS (supplied file)', 'GTFS', 'https://english.bmrc.co.in/', 'MANUAL_SOURCE', 0, None, 'Static timetable/stops from the supplied GTFS package. A timetable, not live data.'),
    ('bmrcl_gtfs_rt_alerts', 'BMRCL GTFS-Realtime Service Alerts', 'GTFS-RT', None, 'AUTH_REQUIRED', 300, 'BMRCL_GTFS_RT_ALERTS_URL (+ BMRCL_API_KEY if required)', 'No public endpoint is documented. Configure only if BMRCL grants access.'),
    ('bmrcl_gtfs_rt_trips', 'BMRCL GTFS-Realtime Trip Updates', 'GTFS-RT', None, 'AUTH_REQUIRED', 120, 'BMRCL_GTFS_RT_TRIPS_URL', 'Needed to compute real delays (predicted minus scheduled).'),
    ('bmrcl_gtfs_rt_vehicles', 'BMRCL GTFS-Realtime Vehicle Positions', 'GTFS-RT', None, 'AUTH_REQUIRED', 60, 'BMRCL_GTFS_RT_VEHICLES_URL', None),
    ('bmrcl_announcements', 'BMRCL official announcements (admin-entered)', 'MANUAL', 'https://english.bmrc.co.in/', 'MANUAL_SOURCE', 0, None, 'Administrators transcribe verified announcements with the source link.'),
    ('bmtc_transit', 'BMTC transit data (last-mile)', 'API', None, 'AUTH_REQUIRED', 600, 'BMTC_API_URL, BMTC_API_KEY', 'Not connected.'),
    ('opencity', 'OpenCity datasets', 'API', 'https://opencity.in/', 'AUTH_REQUIRED', 86400, 'OPENCITY_URL', 'Not connected.'),
    ('osm_stations', 'OpenStreetMap station data (supplied KML)', 'FILE', 'https://www.openstreetmap.org/', 'MANUAL_SOURCE', 0, None, 'Kannada names/aliases merged from the supplied export.'),
    ('ridership_hist', 'Historical hourly ridership (Aug 1-18, Sep 1-30 2025)', 'DATASET', None, 'MANUAL_SOURCE', 0, None, 'Historical entry/exit counts used to train the demand model. Never live.'),
    ('crowd_model', 'AI station-demand model', 'MODEL', None, 'ERROR', 0, None, 'Updated at start-up.'),
    ('emergency_112', 'Emergency contacts (112.gov.in / BMRCL contact page)', 'MANUAL', 'https://112.gov.in/', 'MANUAL_SOURCE', 0, None, 'Verify periodically.'),
]
def seed_sources(db: DB):
    for i, n, t, u, st, stale, req, notes in SOURCES: db.x('INSERT OR IGNORE INTO data_sources(id,name,type,url,status,stale_after_sec,requires,notes) VALUES(?,?,?,?,?,?,?,?)', (i, n, t, u, st, stale, req, notes))

def seed_admin(db: DB):
    if settings.ADMIN_EMAIL and settings.ADMIN_PASSWORD and not db.one('SELECT 1 FROM users WHERE email=?', (settings.ADMIN_EMAIL.lower(),)):
        db.x('INSERT INTO users(email,password_hash,role,display_name,created_at) VALUES(?,?,?,?,?)', (settings.ADMIN_EMAIL.lower(), hash_password(settings.ADMIN_PASSWORD), 'admin', 'Control Room', utcnow()))

def seed_all(db: DB): seed_network(db); seed_contacts(db); seed_sources(db); seed_admin(db)
