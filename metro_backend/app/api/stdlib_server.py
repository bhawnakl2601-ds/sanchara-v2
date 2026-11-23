"""Zero-dependency HTTP server using the same dispatcher as the FastAPI app. Handy for local testing:  python -m metro_backend.serve --stdlib"""
from __future__ import annotations
import json, threading, time, queue
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from ..core.config import settings
from ..core.security import read_token
from ..services import jobs
from ..services.notifications import hub
from .router import dispatch
from . import routes  # noqa: F401  (registers routes)

MAX_BODY = 4 * 1024 * 1024
def make_handler(app):
    class H(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def log_message(self, *a): pass
        def _cors(self):
            o = self.headers.get('Origin', '')
            if o in settings.CORS_ORIGINS: self.send_header('Access-Control-Allow-Origin', o); self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type'); self.send_header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
        def _send(self, status, data):
            b = json.dumps(data, default=str).encode(); self.send_response(status); self._cors()
            self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.send_header('X-Content-Type-Options', 'nosniff'); self.end_headers(); self.wfile.write(b)
        def do_OPTIONS(self): self.send_response(204); self._cors(); self.send_header('Content-Length', '0'); self.end_headers()
        def _run(self, method):
            u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
            if u.path == '/api/stream' and method == 'GET': return self._sse(q)
            body = {}
            n = int(self.headers.get('Content-Length') or 0)
            if n > MAX_BODY: return self._send(413, dict(error='request too large'))
            if n:
                try: body = json.loads(self.rfile.read(n) or b'{}')
                except ValueError: return self._send(400, dict(error='invalid JSON'))
                if not isinstance(body, dict): return self._send(400, dict(error='JSON object expected'))
            s, d = dispatch(app, method, u.path, q, body, dict(self.headers), self.client_address[0]); self._send(s, d)
        def _sse(self, q):
            p = read_token(q.get('token', ''))
            if not p: return self._send(401, dict(error='authentication required'))
            qu = hub.subscribe(p['sub']); self.send_response(200); self._cors(); self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache'); self.send_header('Connection', 'close'); self.end_headers()
            try:
                while True:
                    try: msg = qu.get(timeout=15); self.wfile.write(f'data: {json.dumps(msg)}\n\n'.encode())
                    except queue.Empty: self.wfile.write(b': ping\n\n')
                    self.wfile.flush()
            except Exception: pass
            finally: hub.unsubscribe(p['sub'], qu)
        do_GET = lambda s: s._run('GET'); do_POST = lambda s: s._run('POST'); do_PATCH = lambda s: s._run('PATCH'); do_PUT = lambda s: s._run('PUT'); do_DELETE = lambda s: s._run('DELETE')
    return H

def start_scheduler(app, every=60):
    def loop():
        n = 0
        while True:
            try: jobs.run_all(app); n += 1
            except Exception: import logging; logging.getLogger('sanchara').exception('job failed')
            time.sleep(every)
    threading.Thread(target=loop, daemon=True, name='sanchara-jobs').start()

def serve(app, host='127.0.0.1', port=8000):
    start_scheduler(app); srv = ThreadingHTTPServer((host, port), make_handler(app)); srv.daemon_threads = True; print(f'SANCHARA API (stdlib) on http://{host}:{port}'); srv.serve_forever()
