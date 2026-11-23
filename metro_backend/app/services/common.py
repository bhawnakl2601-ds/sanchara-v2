from __future__ import annotations
import datetime as dt, json
from ..core.database import utcnow

class ApiError(Exception):
    def __init__(self, status: int, message: str, **extra): super().__init__(message); self.status, self.message, self.extra = status, message, extra

def parse_ts(v, field='timestamp', required=True) -> str | None:
    """Accept ISO-8601; naive values are taken as Asia/Kolkata (+05:30), then stored as UTC."""
    if v in (None, ''):
        if required: raise ApiError(422, f'{field} is required')
        return None
    try:
        d = dt.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
    except ValueError: raise ApiError(422, f'{field} must be ISO-8601')
    if d.tzinfo is None: d = d.replace(tzinfo=dt.timezone(dt.timedelta(hours=5, minutes=30)))
    return d.astimezone(dt.timezone.utc).isoformat(timespec='seconds')

def now() -> str: return utcnow()
def need(body: dict, *keys):
    miss = [k for k in keys if body.get(k) in (None, '')]
    if miss: raise ApiError(422, 'missing fields: ' + ', '.join(miss))
def clip(s, n): return (str(s).strip() if s is not None else None) and str(s).strip()[:n]
