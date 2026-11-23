"""Entry point.   python -m metro_backend.serve            -> FastAPI via uvicorn (needs requirements.txt)
                  python -m metro_backend.serve --stdlib   -> zero-dependency server (same routes)"""
import sys, os, logging
from .app.context import App
from .app.core.config import settings

def main():
    logging.basicConfig(level=logging.INFO); port = int(os.environ.get('PORT', '8000')); host = os.environ.get('HOST', '127.0.0.1')
    if settings.ENV == 'production' and (not settings.ADMIN_PASSWORD or settings.JWT_SECRET.startswith('dev-only')): sys.exit('Set JWT_SECRET and ADMIN_EMAIL/ADMIN_PASSWORD in production.')
    app = App()
    if '--stdlib' in sys.argv:
        from .app.api.stdlib_server import serve; serve(app, host, port); return
    try: import uvicorn; from .app.api.fastapi_app import create_app
    except ImportError: sys.exit('FastAPI/uvicorn not installed. Run: pip install -r requirements.txt   (or use --stdlib)')
    uvicorn.run(create_app(app), host=host, port=port)
if __name__ == '__main__': main()
