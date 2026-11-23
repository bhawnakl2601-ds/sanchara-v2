"""Adapter interface. An adapter reports honestly: it never fabricates a successful response, never bypasses access controls, and never invents endpoints."""
from __future__ import annotations
import urllib.request, urllib.error
from dataclasses import dataclass
from ..core.config import settings

@dataclass
class Result:
    status: str                  # CONNECTED | STALE | UNAVAILABLE | AUTH_REQUIRED | ERROR | MANUAL_SOURCE
    message: str = ''
    data_timestamp: str | None = None
    payload: bytes | None = None

class Adapter:
    source_id = ''; env_url: str | None = None; env_help = ''
    def configured(self) -> bool: return bool(self.env_url)
    def fetch(self) -> Result:
        if not self.configured(): return Result('AUTH_REQUIRED', f'No endpoint configured. Set {self.env_help}. Access must be granted by the data owner; SANCHARA does not guess URLs or credentials.')
        try: return self._get(self.env_url)
        except urllib.error.HTTPError as e: return Result('AUTH_REQUIRED' if e.code in (401, 403) else 'ERROR', f'HTTP {e.code} from source')
        except Exception as e: return Result('UNAVAILABLE', f'{type(e).__name__}: {e}')
    def _get(self, url: str) -> Result:
        req = urllib.request.Request(url, headers={'User-Agent': 'SANCHARA/1.0'})
        if getattr(self, 'api_key', None):
            header = settings_header(self)
            if not header: return Result('ERROR', 'API key set but its header name is not configured (see README); refusing to guess an auth scheme.')
            req.add_header(header, self.api_key)
        with urllib.request.urlopen(req, timeout=10) as r: return Result('CONNECTED', 'ok', payload=r.read())

def settings_header(a) -> str | None:
    from ..core.config import env
    return env('BMRCL_API_KEY_HEADER') if a.source_id.startswith('bmrcl') else env('BMTC_API_KEY_HEADER')
