"""FastAPI adapter: every route in router.ROUTES is mounted through one generic handler, so behaviour is identical to the stdlib server. Adds OpenAPI docs at /docs and a WebSocket at /ws.
NOTE: written against the FastAPI API but not executed in the authoring sandbox (FastAPI was not installable there) - run `pytest metro_backend/tests` after `pip install -r backend/requirements.txt`."""
from __future__ import annotations
import asyncio, json
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from ..core.config import settings
from ..core.security import read_token
from ..services.notifications import hub
from ..services import jobs
from .router import dispatch, ROUTES
from . import routes  # noqa: F401

def create_app(app_ctx) -> FastAPI:
    api = FastAPI(title='SANCHARA Smart Alerts API', version='1.0', description='Application endpoints for SANCHARA (not official BMRCL endpoints).')
    api.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ORIGINS, allow_methods=['*'], allow_headers=['Authorization', 'Content-Type'])
    async def handle(request: Request, full_path: str = ''):
        body = {}
        if request.method in ('POST', 'PATCH', 'PUT'):
            raw = await request.body()
            if len(raw) > 4 * 1024 * 1024: return JSONResponse({'error': 'request too large'}, 413)
            try: body = json.loads(raw or b'{}')
            except ValueError: return JSONResponse({'error': 'invalid JSON'}, 400)
            if not isinstance(body, dict): return JSONResponse({'error': 'JSON object expected'}, 400)
        status, data = await run_in_threadpool(dispatch, app_ctx, request.method, request.url.path, dict(request.query_params), body, dict(request.headers), request.client.host if request.client else '')
        return JSONResponse(data, status_code=status)
    for r in ROUTES:   # register each concrete route so /docs lists them
        api.add_api_route(r.pattern, handle, methods=[r.method], name=r.handler.__name__, summary=(r.handler.__doc__ or r.handler.__name__), include_in_schema=True)
    @api.websocket('/ws')
    async def ws(sock: WebSocket, token: str = ''):
        p = read_token(token)
        if not p: await sock.close(code=4401); return
        await sock.accept(); q = hub.subscribe(p['sub'])
        try:
            while True:
                try: msg = await asyncio.get_event_loop().run_in_executor(None, lambda: q.get(timeout=20)); await sock.send_json(msg)
                except Exception: await sock.send_json({'ping': True})
        except WebSocketDisconnect: pass
        finally: hub.unsubscribe(p['sub'], q)
    @api.on_event('startup')
    async def _start():
        async def loop():
            while True:
                await run_in_threadpool(jobs.run_all, app_ctx); await asyncio.sleep(60)
        asyncio.create_task(loop())
    return api
