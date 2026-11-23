"""Framework-neutral routing table. Handlers receive a Ctx and return JSON-able data (or (status, data)). Both server adapters dispatch through `dispatch`,
so authentication, role checks (always re-read from the DB, never trusted from the token), validation errors and rate limits behave identically."""
from __future__ import annotations
import re, time, hashlib
from dataclasses import dataclass, field
from ..core.security import read_token
from ..services.common import ApiError

@dataclass
class Ctx:
    app: object; method: str; path: str; params: dict = field(default_factory=dict); query: dict = field(default_factory=dict); body: dict = field(default_factory=dict)
    headers: dict = field(default_factory=dict); ip: str = ''; user: dict | None = None
    @property
    def reporter_key(self) -> str: return hashlib.sha256((self.ip + '|' + self.headers.get('user-agent', '')).encode()).hexdigest()[:24]

@dataclass
class Route:
    method: str; pattern: str; handler: object; auth: str | None = None; limit: tuple[int, int] | None = None   # auth: None | 'user' | 'admin'; limit: (max, per_seconds)
    rx: re.Pattern = None
    def __post_init__(self): self.rx = re.compile('^' + re.sub(r'\{(\w+)\}', r'(?P<\1>[^/]+)', self.pattern) + '$')

ROUTES: list[Route] = []
def route(method: str, pattern: str, auth: str | None = None, limit: tuple[int, int] | None = None):
    def deco(fn): ROUTES.append(Route(method, pattern, fn, auth, limit)); return fn
    return deco

_buckets: dict[str, list[float]] = {}
def _limit(key: str, n: int, per: int):
    t = time.time(); h = [x for x in _buckets.get(key, []) if t - x < per]
    if len(h) >= n: raise ApiError(429, 'rate limit exceeded; please slow down')
    h.append(t); _buckets[key] = h

def authenticate(app, headers: dict) -> dict | None:
    h = headers.get('authorization', '')
    if not h.lower().startswith('bearer '): return None
    p = read_token(h[7:].strip())
    if not p: return None
    return app.db.one('SELECT id,email,role,display_name FROM users WHERE id=?', (p['sub'],))      # role comes from the DB, not from the token

def dispatch(app, method: str, path: str, query: dict, body: dict, headers: dict, ip: str) -> tuple[int, dict]:
    headers = {k.lower(): v for k, v in headers.items()}
    try:
        path_ok = False
        for r in ROUTES:
            m = r.rx.match(path)
            if not m: continue
            path_ok = True
            if r.method != method: continue
            ctx = Ctx(app, method, path, m.groupdict(), query, body or {}, headers, ip, authenticate(app, headers))
            if r.limit: _limit(f'{ip}:{r.method}:{r.pattern}', *r.limit)
            if r.auth and not ctx.user: raise ApiError(401, 'authentication required')
            if r.auth == 'admin' and ctx.user['role'] != 'admin': raise ApiError(403, 'administrator access required')
            out = r.handler(ctx)
            return out if isinstance(out, tuple) else (200, out)
        raise ApiError(405 if path_ok else 404, 'method not allowed' if path_ok else 'not found')
    except ApiError as e: return e.status, dict(error=e.message, **e.extra)
    except Exception as e:                          # never leak internals
        import logging; logging.getLogger('sanchara').exception('unhandled error')
        return 500, dict(error='internal error')
