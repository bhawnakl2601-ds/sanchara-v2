"""Password hashing (scrypt) and HS256 JWTs using only the standard library."""
from __future__ import annotations
import base64, hashlib, hmac, json, os, time
from .config import settings

def hash_password(pw: str) -> str:
    salt = os.urandom(16); h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f'scrypt${salt.hex()}${h.hex()}'
def verify_password(pw: str, stored: str) -> bool:
    try: _, s, h = stored.split('$'); calc = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(s), n=2**14, r=8, p=1, dklen=32)
    except Exception: return False
    return hmac.compare_digest(calc.hex(), h)
def _b64(b: bytes) -> str: return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def _unb64(s: str) -> bytes: return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))
def make_token(user_id: int, role: str, ttl: int | None = None) -> str:
    head = _b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode()); body = _b64(json.dumps({'sub': user_id, 'role': role, 'exp': int(time.time()) + (ttl or settings.JWT_TTL_SEC)}).encode())
    sig = _b64(hmac.new(settings.JWT_SECRET.encode(), f'{head}.{body}'.encode(), hashlib.sha256).digest()); return f'{head}.{body}.{sig}'
def read_token(tok: str) -> dict | None:
    try:
        h, b, s = tok.split('.'); good = _b64(hmac.new(settings.JWT_SECRET.encode(), f'{h}.{b}'.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(good, s): return None
        p = json.loads(_unb64(b)); return p if p.get('exp', 0) > time.time() else None
    except Exception: return None
