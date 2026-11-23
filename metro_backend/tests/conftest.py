import pytest, datetime as dt
from metro_backend.app.context import App
from metro_backend.app.api.router import dispatch
from metro_backend.app.api import routes  # noqa
from metro_backend.app.core.config import settings
from metro_backend.app.core.security import make_token

class Client:
    def __init__(self, app): self.app = app
    def call(self, method, path, body=None, token=None, query=None, ip='1.1.1.1'):
        h = {'authorization': f'Bearer {token}'} if token else {}
        return dispatch(self.app, method, path, query or {}, body or {}, h, ip)
    def register(self, email='p@example.com', pw='password123'):
        s, d = self.call('POST', '/api/auth/register', dict(email=email, password=pw)); assert s == 201, d; return d['token'], d['user']['id']
    def admin(self):
        s, d = self.call('POST', '/api/auth/login', dict(email=settings.ADMIN_EMAIL, password=settings.ADMIN_PASSWORD)); assert s == 200, d; return d['token']

@pytest.fixture()
def app(tmp_path):
    settings.UPLOAD_DIR = tmp_path / 'up'; settings.ASSISTANCE_SUBMISSIONS_ENABLED = True
    from metro_backend.app.api import router; router._buckets.clear()
    return App('sqlite:///:memory:', load_model=False)
@pytest.fixture()
def c(app): return Client(app)
@pytest.fixture()
def admin(c): return c.admin()
def iso(hours=0): return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=hours)).isoformat(timespec='seconds')
