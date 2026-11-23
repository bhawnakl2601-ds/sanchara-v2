"""Application container: wires services together. Framework-neutral (used by the FastAPI app and the stdlib server)."""
from __future__ import annotations
from .core.database import DB
from .seed import seed_all
from .services.network import Network
from .services.notifications import Notifier
from .services.alerts import Alerts
from .services.closures import Closures
from .services.crowd import Crowd
from .services.lostfound import LostFound
from .services.reports import Reports
from .services.sources import Sources

class App:
    def __init__(self, db_url: str | None = None, load_model: bool = True):
        self.db = DB(db_url); seed_all(self.db); self.net = Network()
        self.predictor = None
        if load_model:
            from metro_backend.ml.predict import Predictor
            self.predictor = Predictor()
        else:
            class _Off:
                def status(s): return dict(state='MODEL_UNAVAILABLE', model_loaded=False, mode='unavailable', error='model disabled', model_version=None, data_through=None)
                state = 'MODEL_UNAVAILABLE'
                def predict(s, *a, **k): return dict(available=False, reason='model disabled')
                def heatmap(s, *a, **k): return dict(available=False, reason='model disabled')
                def profile(s, *a, **k): return dict(available=False)
                def validation(s): return {}
                def stations(s): return []
                meta = {}
            self.predictor = _Off()
        self.notifier = Notifier(self.db); self.alerts = Alerts(self.db, self.net, self.notifier); self.closures = Closures(self.db, self.net, self.notifier)
        self.crowd = Crowd(self.db, self.net, self.predictor); self.lf = LostFound(self.db, self.net, self.notifier); self.reports = Reports(self.db, self.net); self.sources = Sources(self.db, self.predictor)
        self.sources.refresh()
