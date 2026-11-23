"""Scheduled work. Call run_all() periodically (the servers do it every minute) or via POST /api/admin/jobs/run."""
from __future__ import annotations
import datetime as dt, json
from .notifications import LEVEL_RANK

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
def crowd_scan(app, now: dt.datetime | None = None, lookahead_hours: int = 3) -> int:
    """Crowd warnings: only when predicted relative demand >= the user's threshold AND model uncertainty is acceptable (not HIGH).
    Dedupes by station/date/hour/level; suggests a quieter window only when the model supports it."""
    if not app.predictor.status().get('model_loaded'): return 0
    now = now or dt.datetime.now(IST); sent = 0
    subs = app.db.q("SELECT user_id,target FROM passenger_subscriptions WHERE kind IN ('crowd','station') AND target!=''")
    for s in subs:
        if s['target'] not in app.net.stations: continue
        prefs = app.notifier.prefs(s['user_id']); min_rank = LEVEL_RANK[prefs['crowd_min_level']]
        pred = app.predictor.predict(s['target'], now.date(), list(range(now.hour, min(24, now.hour + 1 + lookahead_hours))))
        if not pred.get('available'): continue
        for h in pred['hours']:
            if h['level'] and LEVEL_RANK[h['level']] >= min_rank and h['uncertainty'] != 'HIGH':
                quiet = [x['hour'] for x in (app.crowd.quiet_windows(s['target'], now.date().isoformat())) if x['hour'] > h['hour']][:2]
                name = app.net.stations[s['target']]['name']
                body = f"Predicted {h['level']} demand at {name} around {h['hour']:02d}:00 (~{h['entries']} entries, ~{h['exits']} exits/hour). AI estimate from historical patterns, not live occupancy." + (f" Quieter predicted hours later: {', '.join(f'{q:02d}:00' for q in quiet)}." if quiet else '')
                r = app.notifier.send(s['user_id'], 'CROWD_WARNING', f"Busy period expected at {name}", body, key=f"crowd:{s['target']}:{now.date()}:{h['hour']}:{h['level']}", verification='MODEL_ESTIMATE', source_label=f"AI model {pred['model_version']}", payload=dict(station=s['target'], hour=h['hour']), expires_at=(now.replace(hour=h['hour'], minute=59, second=0, microsecond=0)).astimezone(dt.timezone.utc).isoformat(timespec='seconds'))
                sent += int(r['sent'])
    return sent

def run_all(app) -> dict:
    return dict(closures=app.closures.refresh(), alerts_expired=app.alerts.expire(), closure_pre_notices=app.closures.pre_notice(), crowd_notifications=crowd_scan(app))
