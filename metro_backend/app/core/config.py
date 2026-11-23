"""Environment-driven settings. Nothing secret is hard-coded; see metro_backend/.env.example."""
from __future__ import annotations
import os, secrets
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def _load_dotenv():
    p = Path(__file__).resolve().parents[2]/'.env'
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1); os.environ.setdefault(k.strip(), v.strip().strip('"\''))
_load_dotenv()
def env(k, default=None): return os.environ.get(k, default)

class Settings:
    ENV = env('SANCHARA_ENV', 'dev')                                   # dev | production
    DATABASE_URL = env('DATABASE_URL', f'sqlite:///{ROOT}/metro_backend/metro.db')   # sqlite only in this build; see README for Postgres notes
    JWT_SECRET = env('JWT_SECRET') or (secrets.token_urlsafe(32) if ENV == 'production' else 'dev-only-secret-change-me')
    JWT_TTL_SEC = int(env('JWT_TTL_SEC', '28800'))
    ADMIN_EMAIL = env('ADMIN_EMAIL', 'admin@sanchara.local' if ENV == 'dev' else None)
    ADMIN_PASSWORD = env('ADMIN_PASSWORD', 'sanchara-admin-dev' if ENV == 'dev' else None)
    CORS_ORIGINS = [o for o in env('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',') if o]
    UPLOAD_DIR = Path(env('UPLOAD_DIR', str(ROOT/'metro_backend'/'uploads')))
    MAX_UPLOAD_BYTES = int(env('MAX_UPLOAD_BYTES', str(2*1024*1024)))
    REPORT_RATE_LIMIT_PER_HOUR = int(env('REPORT_RATE_LIMIT_PER_HOUR', '6'))
    NOTIFY_COOLDOWN_SEC = int(env('NOTIFY_COOLDOWN_SEC', '1800'))
    SOURCE_STALE_AFTER_SEC = int(env('SOURCE_STALE_AFTER_SEC', '900'))
    # Passenger Assistance (Lost & Found, passenger reports) is a WORK-IN-PROGRESS module: submissions are OFF unless explicitly enabled.
    ASSISTANCE_SUBMISSIONS_ENABLED = env('ASSISTANCE_SUBMISSIONS_ENABLED', 'false').strip().lower() in ('1', 'true', 'yes')
    # delay display thresholds (SANCHARA display thresholds, NOT official BMRCL categories)
    DELAY_MINOR_MIN, DELAY_MODERATE_MIN, DELAY_MAJOR_MIN = int(env('DELAY_MINOR_MIN', '3')), int(env('DELAY_MODERATE_MIN', '6')), int(env('DELAY_MAJOR_MIN', '11'))
    # external feeds - leave empty unless you hold authorised access
    BMRCL_GTFS_RT_ALERTS_URL = env('BMRCL_GTFS_RT_ALERTS_URL'); BMRCL_GTFS_RT_TRIPS_URL = env('BMRCL_GTFS_RT_TRIPS_URL'); BMRCL_GTFS_RT_VEHICLES_URL = env('BMRCL_GTFS_RT_VEHICLES_URL')
    BMRCL_API_KEY = env('BMRCL_API_KEY'); BMTC_API_URL = env('BMTC_API_URL'); BMTC_API_KEY = env('BMTC_API_KEY'); OPENCITY_URL = env('OPENCITY_URL')
    FCM_SERVER_KEY = env('FCM_SERVER_KEY'); FIREBASE_CREDENTIALS_JSON = env('FIREBASE_CREDENTIALS_JSON')
settings = Settings()
