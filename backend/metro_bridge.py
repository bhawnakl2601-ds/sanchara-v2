"""
metro_bridge.py  -  plugs the METRO API into the BMTC Flask server.

Why this file exists
--------------------
The metro project was written as its own little web server (port 8000).  The BMTC project is a Flask
server (port 5000).  We want ONE server, so instead of running two programs we teach Flask to answer
metro requests as well.  Every metro API request is forwarded to metro's own `dispatch()` function -
the same function metro's original servers used - so metro behaves exactly as before.

URL layout (this is what keeps the two apps from clashing):
    /api/...          -> BMTC API   (unchanged)
    /metro-api/...    -> METRO API  (e.g. /metro-api/api/alerts/active)
"""
import json
import logging
import queue

from flask import Blueprint, Response, request, stream_with_context

log = logging.getLogger('sanchara.metro')

# A Blueprint is a "mini Flask app" - a bundle of routes that we later plug into the real app.
# url_prefix means every route inside it automatically starts with /metro-api
metro_bp = Blueprint('metro_api', __name__, url_prefix='/metro-api')

MAX_BODY = 4 * 1024 * 1024      # refuse request bodies larger than 4 MB (same limit metro always used)
_metro_ctx = None               # will hold the metro "application container" once it has started
_metro_error = None             # if metro fails to start we remember why, so the browser can be told


def _json(data, status=200):
    """Build a JSON response.  default=str lets dates and other odd types be written as text."""
    return Response(json.dumps(data, default=str), status=status, mimetype='application/json')


@metro_bp.route('/', defaults={'sub': ''}, methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
@metro_bp.route('/<path:sub>', methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
def metro_api(sub):
    """Catch EVERY request that starts with /metro-api and pass it to metro's router."""
    if _metro_ctx is None:
        return _json({'error': 'Metro service is unavailable', 'detail': _metro_error}, 503)

    from metro_backend.app.api.router import dispatch

    path = '/' + sub                                   # '/metro-api/api/alerts' -> sub='api/alerts' -> path='/api/alerts'
    query = {k: v[0] for k, v in request.args.lists()}  # ?a=1&b=2  ->  {'a': '1', 'b': '2'}

    if path == '/api/stream' and request.method == 'GET':
        return _stream(query)                          # live notifications (Server-Sent Events)

    body = {}
    if request.method in ('POST', 'PATCH', 'PUT'):
        raw = request.get_data()
        if len(raw) > MAX_BODY:
            return _json({'error': 'request too large'}, 413)
        try:
            body = json.loads(raw or b'{}')
        except ValueError:
            return _json({'error': 'invalid JSON'}, 400)
        if not isinstance(body, dict):
            return _json({'error': 'JSON object expected'}, 400)

    status, data = dispatch(_metro_ctx, request.method, path, query, body,
                            dict(request.headers), request.remote_addr or '')
    return _json(data, status)


def _stream(query):
    """Server-Sent Events: keeps the connection open and pushes a message whenever the user has a new notification."""
    from metro_backend.app.core.security import read_token
    from metro_backend.app.services.notifications import hub

    payload = read_token(query.get('token', ''))
    if not payload:
        return _json({'error': 'authentication required'}, 401)
    q = hub.subscribe(payload['sub'])

    def events():
        try:
            while True:
                try:
                    yield f'data: {json.dumps(q.get(timeout=15))}\n\n'
                except queue.Empty:
                    yield ': ping\n\n'                  # keeps the connection from timing out
        finally:
            hub.unsubscribe(payload['sub'], q)          # runs when the browser disconnects

    return Response(stream_with_context(events()), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


def register_metro(flask_app):
    """Start the metro engine and plug its routes into `flask_app`.  Called once from backend/app.py."""
    global _metro_ctx, _metro_error
    try:
        from metro_backend.app.context import App as MetroApp      # loads DB, station network, crowd model
        from metro_backend.app.api import routes                   # noqa: F401  (importing registers every metro route)
        from metro_backend.app.api.stdlib_server import start_scheduler
        _metro_ctx = MetroApp()
        start_scheduler(_metro_ctx)                                 # background thread: refreshes closures/alerts every 60 s
        log.info('Metro engine started')
    except Exception as exc:                                        # BMTC must still work even if metro cannot start
        _metro_error = f'{type(exc).__name__}: {exc}'
        log.exception('Metro engine failed to start')
        print(f'[SANCHARA] WARNING: metro engine failed to start -> {_metro_error}')
    flask_app.register_blueprint(metro_bp)
