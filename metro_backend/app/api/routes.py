from __future__ import annotations
import base64, json, datetime as dt, re
from .router import route, Ctx
from ..core.security import hash_password, verify_password, make_token
from ..core.database import utcnow
from ..core.config import settings
from ..services.common import ApiError, need, clip
from ..services import reports as rep, jobs
from ..services.network import restrictions, journey_impact
from ..services.alerts import CATEGORIES as ALERT_CATS

EMAIL = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$')
def _img(ctx: Ctx):
    b = ctx.body.get('image_b64')
    if not b: return None
    try: data = base64.b64decode(b.split(',')[-1], validate=True)
    except Exception: raise ApiError(422, 'image_b64 is not valid base64')
    return rep.save_image(data)

# ---- public / auth ------------------------------------------------------------------------------------------------------------
@route('GET', '/api/health')
def health(c: Ctx): return dict(ok=True, time=utcnow(), env=settings.ENV)
@route('GET', '/api/status')
def status(c: Ctx): return dict(feed=c.app.sources.live_status(), crowd=c.app.crowd.status(), server_time=utcnow())
@route('POST', '/api/auth/register', limit=(10, 3600))
def register(c: Ctx):
    need(c.body, 'email', 'password'); e = c.body['email'].strip().lower()
    if not EMAIL.match(e): raise ApiError(422, 'invalid email')
    if len(c.body['password']) < 8: raise ApiError(422, 'password must be at least 8 characters')
    if c.app.db.one('SELECT 1 FROM users WHERE email=?', (e,)): raise ApiError(409, 'an account with this email already exists')
    uid = c.app.db.x('INSERT INTO users(email,password_hash,role,display_name,created_at) VALUES(?,?,?,?,?)', (e, hash_password(c.body['password']), 'passenger', clip(c.body.get('display_name'), 60), utcnow()))   # role is NEVER taken from the request
    return 201, dict(token=make_token(uid, 'passenger'), user=dict(id=uid, email=e, role='passenger'))
@route('POST', '/api/auth/login', limit=(20, 600))
def login(c: Ctx):
    need(c.body, 'email', 'password'); u = c.app.db.one('SELECT * FROM users WHERE email=?', (c.body['email'].strip().lower(),))
    if not u or not verify_password(c.body['password'], u['password_hash']): raise ApiError(401, 'invalid email or password')
    return dict(token=make_token(u['id'], u['role']), user=dict(id=u['id'], email=u['email'], role=u['role'], display_name=u['display_name']))
@route('GET', '/api/auth/me', auth='user')
def me(c: Ctx): return c.user

# ---- stations ----------------------------------------------------------------------------------------------------------------
@route('GET', '/api/stations')
def stations(c: Ctx):
    alerts = c.app.alerts.list(status='ACTIVE'); cnt: dict[str, int] = {}
    for a in alerts:
        for s in a['stations']: cnt[s] = cnt.get(s, 0) + 1
    return [dict(r, lines=r['lines'].split(','), active_alerts=cnt.get(r['id'], 0)) for r in c.app.db.q('SELECT id,name,kn,lat,lon,lines,interchange,wheelchair FROM stations ORDER BY name')]
@route('GET', '/api/stations/{id}')
def station(c: Ctx):
    sid = c.params['id']; s = c.app.db.one('SELECT * FROM stations WHERE id=?', (sid,))
    if not s: raise ApiError(404, 'station not found')
    s['lines'] = s['lines'].split(','); s['aliases'] = [a['alias'] for a in c.app.db.q('SELECT alias FROM station_aliases WHERE station_id=?', (sid,))]
    s['alerts'] = [a for a in c.app.alerts.list(status='ACTIVE') if sid in a['stations']]
    res = restrictions(c.app.db, c.app.net); s['closure'] = [x for x in res['closedStations'] if x['id'] == sid]
    nb = c.app.net.order[s['lines'][0]]; i = nb.index(sid) if sid in nb else 0
    s['neighbours'] = [dict(id=x, name=c.app.net.stations[x]['name']) for x in nb[max(0, i - 1):i + 2] if x != sid]
    p = c.app.crowd.station(sid, None); s['crowd'] = p if p.get('available') else None
    s['reports_under_review'] = c.app.db.one("SELECT COUNT(*) n FROM passenger_reports WHERE station_id=? AND status IN ('SUBMITTED','UNDER_REVIEW')", (sid,))['n']
    s['facilities'] = dict(wheelchair=bool(s['wheelchair']), note='Detailed facility data (lifts, toilets, exits) is not available from the supplied datasets.')
    return s

# ---- alerts / closures / routes --------------------------------------------------------------------------------------------------
@route('GET', '/api/alerts')
def alerts(c: Ctx): return dict(alerts=c.app.alerts.list(line=c.query.get('line'), status=c.query.get('status')), feed=c.app.sources.live_status())
@route('GET', '/api/alerts/active')
def alerts_active(c: Ctx): return dict(alerts=c.app.alerts.list(status='ACTIVE', line=c.query.get('line')), feed=c.app.sources.live_status())
@route('GET', '/api/alerts/{id}')
def alert_get(c: Ctx): return c.app.alerts.get(int(c.params['id']))
@route('GET', '/api/closures/active')
def closures_active(c: Ctx): return c.app.closures.active()
@route('GET', '/api/closures')
def closures_list(c: Ctx):
    rows = [x for x in c.app.closures.list() if x['status'] in ('SCHEDULED', 'ACTIVE', 'EXTENDED', 'RESOLVED', 'CANCELLED')]; return dict(closures=rows)
@route('GET', '/api/routes/restrictions')
def restr(c: Ctx): c.app.closures.refresh(); return restrictions(c.app.db, c.app.net)
def _legs(body):
    legs = body.get('legs')
    if not isinstance(legs, list) or not legs or any(not isinstance(l, dict) or 'line' not in l or not isinstance(l.get('stations'), list) or len(l['stations']) < 2 for l in legs): raise ApiError(422, 'legs must be [{line, stations:[...]}]')
    return legs
@route('POST', '/api/routes/impact')
def impact(c: Ctx):
    c.app.closures.refresh(); res = restrictions(c.app.db, c.app.net); r = journey_impact(c.app.net, _legs(c.body), res)
    return dict(r, restrictions=res, engine='client', note='Alternative routes are computed by the SANCHARA route engine in the app using these restrictions.')
@route('GET', '/api/routes/affected', auth='user')
def affected(c: Ctx):
    c.app.closures.refresh(); res = restrictions(c.app.db, c.app.net); out = []
    for j in c.app.db.q('SELECT * FROM saved_journeys WHERE user_id=?', (c.user['id'],)):
        i = journey_impact(c.app.net, json.loads(j['legs']), res)
        if i['affected']: out.append(dict(journey_id=j['id'], label=j['label'], origin=j['origin'], destination=j['destination'], hits=i['hits']))
    return dict(affected=out, restrictions=res)
@route('POST', '/api/routes/recalculate')
def recalc(c: Ctx): return impact(c)

# ---- journeys, subscriptions, notifications ---------------------------------------------------------------------------------------
@route('GET', '/api/journeys', auth='user')
def journeys(c: Ctx):
    c.app.closures.refresh(); res = restrictions(c.app.db, c.app.net); out = []
    for j in c.app.db.q('SELECT * FROM saved_journeys WHERE user_id=? ORDER BY id DESC', (c.user['id'],)):
        legs = json.loads(j['legs']); i = journey_impact(c.app.net, legs, res); out.append(dict(j, legs=legs, affected=i['affected'], hits=i['hits']))
    return out
@route('POST', '/api/journeys', auth='user')
def journey_save(c: Ctx):
    need(c.body, 'origin', 'destination'); legs = _legs(c.body)
    for l in legs:
        if l['line'] not in c.app.net.lines or any(not c.app.net.valid_station(s) for s in l['stations']): raise ApiError(422, 'unknown line or station in journey')
    n = c.app.db.one('SELECT COUNT(*) n FROM saved_journeys WHERE user_id=?', (c.user['id'],))['n']
    if n >= 20: raise ApiError(409, 'saved-journey limit (20) reached')
    now = utcnow(); jid = c.app.db.x('INSERT INTO saved_journeys(user_id,label,origin,destination,legs,fare,duration_min,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', (c.user['id'], clip(c.body.get('label'), 60), c.body['origin'], c.body['destination'], json.dumps(legs), c.body.get('fare'), c.body.get('duration_min'), now, now))
    c.app.db.x('INSERT OR IGNORE INTO passenger_subscriptions(user_id,kind,target,created_at) VALUES(?,?,?,?)', (c.user['id'], 'route', str(jid), now))
    i = journey_impact(c.app.net, legs, restrictions(c.app.db, c.app.net)); return 201, dict(id=jid, affected=i['affected'], hits=i['hits'])
@route('DELETE', '/api/journeys/{id}', auth='user')
def journey_del(c: Ctx):
    c.app.db.x('DELETE FROM saved_journeys WHERE id=? AND user_id=?', (int(c.params['id']), c.user['id'])); c.app.db.x("DELETE FROM passenger_subscriptions WHERE user_id=? AND kind='route' AND target=?", (c.user['id'], c.params['id'])); return dict(ok=True)
@route('GET', '/api/notifications', auth='user')
def notifs(c: Ctx): return dict(notifications=c.app.notifier.list(c.user['id'], c.query.get('unread') == '1'), unread=c.app.db.one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL', (c.user['id'],))['n'])
@route('POST', '/api/notifications/read', auth='user')
def notif_read(c: Ctx): c.app.notifier.mark_read(c.user['id'], [int(i) for i in c.body.get('ids', [])] or None); return dict(ok=True)
@route('GET', '/api/notifications/subscriptions', auth='user')
def subs(c: Ctx): return c.app.db.q('SELECT id,kind,target,created_at FROM passenger_subscriptions WHERE user_id=?', (c.user['id'],))
@route('POST', '/api/notifications/subscribe', auth='user')
def subscribe(c: Ctx):
    need(c.body, 'kind'); k, t = c.body['kind'], str(c.body.get('target') or '')
    if k not in ('station', 'line', 'crowd', 'delays', 'closures'): raise ApiError(422, 'kind must be station|line|crowd|delays|closures')
    if k in ('station', 'crowd') and not c.app.net.valid_station(t): raise ApiError(422, 'unknown station')
    if k == 'line' and t.upper() not in c.app.net.lines: raise ApiError(422, 'unknown line')
    if k in ('delays', 'closures') and t and t.upper() not in c.app.net.lines: raise ApiError(422, 'target must be empty (all) or a line')
    t = t.upper() if k in ('line', 'delays', 'closures') else t
    c.app.db.x('INSERT OR IGNORE INTO passenger_subscriptions(user_id,kind,target,created_at) VALUES(?,?,?,?)', (c.user['id'], k, t, utcnow())); return 201, dict(ok=True)
@route('DELETE', '/api/notifications/subscribe/{id}', auth='user')
def unsubscribe(c: Ctx): c.app.db.x('DELETE FROM passenger_subscriptions WHERE id=? AND user_id=? AND kind!="route"', (int(c.params['id']), c.user['id'])); return dict(ok=True)
@route('GET', '/api/notifications/preferences', auth='user')
def prefs_get(c: Ctx): return c.app.notifier.prefs(c.user['id'])
@route('PATCH', '/api/notifications/preferences', auth='user')
def prefs_set(c: Ctx): return c.app.notifier.set_prefs(c.user['id'], c.body, c.body.get('fcm_token'))

# ---- crowd --------------------------------------------------------------------------------------------------------------------
@route('GET', '/api/crowd/status')
def crowd_status(c: Ctx): return c.app.crowd.status()
@route('GET', '/api/crowd/validation')
def crowd_validation(c: Ctx): return c.app.crowd.validation()
@route('GET', '/api/crowd/predictions')
def crowd_pred(c: Ctx):
    if not c.query.get('station'): raise ApiError(422, 'station is required'); 
    return c.app.crowd.station(c.query['station'], c.query.get('date'))
@route('GET', '/api/crowd/stations/{id}')
def crowd_station(c: Ctx): return c.app.crowd.station(c.params['id'], c.query.get('date'))
@route('GET', '/api/crowd/heatmap')
def crowd_heat(c: Ctx): return c.app.crowd.heatmap(c.query.get('date'), c.query.get('hour', '9'))
@route('GET', '/api/crowd/busiest')
def crowd_busy(c: Ctx): return dict(items=c.app.crowd.busiest(c.query.get('date'), c.query.get('hour', '9')))
@route('GET', '/api/crowd/quiet/{id}')
def crowd_quiet(c: Ctx): return dict(windows=c.app.crowd.quiet_windows(c.params['id'], c.query.get('date')))
@route('GET', '/api/crowd/events')
def crowd_events(c: Ctx): return dict(events=c.app.crowd.events())
@route('GET', '/api/crowd/events/{id}/scenario')
def crowd_scn(c: Ctx):
    ms = c.query.get('metro_share'); return c.app.crowd.scenario(int(c.params['id']), float(ms) if ms else None)

# ---- emergency / lost & found / reports -------------------------------------------------------------------------------------------
@route('GET', '/api/emergency/contacts')
def contacts(c: Ctx):
    rows = c.app.db.q('SELECT id,name,kind,phone,email,description,source_url,verification_status,last_verified_at FROM emergency_contacts ORDER BY sort')
    for r in rows: r['tel'] = 'tel:' + re.sub(r'[^\d+]', '', r['phone']) if r['phone'] else None; r['mailto'] = f"mailto:{r['email']}" if r['email'] else None
    for r in rows: r['status_label'] = 'verified by admin' if r['verification_status'] == 'VERIFIED_BY_ADMIN' else 'provided, not yet verified'; r['last_verified_label'] = r['last_verified_at'] or 'not verified yet'
    not_configured = [dict(name='Station-specific help desk numbers', status='NOT_CONFIGURED', note='No verified per-station contact data is available; ask station staff or use the BMRCL helpline.'),
                      dict(name='Accessibility assistance line', status='NOT_VERIFIED', note='No verified accessibility assistance contact is configured. Use the BMRCL helpline.'),
                      dict(name='Separate police / medical / fire numbers', status='USE_112', note='112 is the single emergency number for police, fire and ambulance in India. No other numbers are listed because none are verified here.')]
    return dict(contacts=rows, not_configured=not_configured, instructions=['In immediate danger call 112.', 'Move away from hazards; follow station staff and security instructions.', 'For metro-specific help use the BMRCL helpline.'], monitored_in_real_time=False, warning='Emergency information must be verified periodically against official sources. SANCHARA does not dispatch emergency services; in immediate danger call 112.', nearest_station_hint='Use a station\'s page for its neighbours; exit-level data is not available.')
@route('POST', '/api/emergency/nearest-station')
def nearest(c: Ctx):
    """Location is used for this one calculation only: it is not stored or logged."""
    try: lat, lon = float(c.body['lat']), float(c.body['lon'])
    except (KeyError, TypeError, ValueError): raise ApiError(422, 'lat and lon are required numbers')
    from ..services.lostfound import km
    best = sorted(((km((lat, lon), (s['lat'], s['lon'])), sid) for sid, s in c.app.net.stations.items()))[:3]
    return dict(stations=[dict(id=sid, name=c.app.net.stations[sid]['name'], km=round(d, 2)) for d, sid in best])
@route('GET', '/api/lost-found/options')
def lf_options(c: Ctx):
    from ..services.lostfound import CATEGORIES; return dict(categories=CATEGORIES)
def _assist_on():
    from ..core.config import settings
    if not settings.ASSISTANCE_SUBMISSIONS_ENABLED: raise ApiError(503, 'Passenger Assistance is a work in progress: submissions are switched off in this release. In an emergency call 112; for lost property contact BMRCL directly.')
@route('GET', '/api/assistance/status')
def assist_status(c: Ctx):
    from ..core.config import settings
    on = settings.ASSISTANCE_SUBMISSIONS_ENABLED
    return dict(status='WORK_IN_PROGRESS', submissions_enabled=on, lost_found=dict(status='WORK_IN_PROGRESS', submissions=on, matching='experimental text/attribute similarity only; staff verification required', monitored_in_real_time=False),
                emergency=dict(status='INFORMATION_ONLY', dispatch=False, note='SANCHARA does not receive or dispatch emergency requests and is not monitored in real time.'),
                message='Passenger Assistance is a work in progress. ' + ('Submissions are enabled for testing and are NOT monitored in real time.' if on else 'Submissions are switched off in this release.'))
@route('POST', '/api/lost-found/lost', limit=(10, 3600))
def lf_lost(c: Ctx): _assist_on(); return 201, c.app.lf.submit_lost(c.user, c.body, _img(c))
@route('POST', '/api/lost-found/found', limit=(10, 3600))
def lf_found(c: Ctx): _assist_on(); return 201, c.app.lf.submit_found(c.user, c.body, _img(c))
@route('GET', '/api/lost-found/matches', auth='user')
def lf_matches(c: Ctx): return dict(matches=c.app.lf.my_matches(c.user), mine=c.app.lf.my_lost(c.user))
@route('POST', '/api/lost-found/claim', auth='user', limit=(10, 3600))
def lf_claim(c: Ctx): _assist_on(); need(c.body, 'match_id'); return c.app.lf.claim(c.user, int(c.body['match_id']), c.body.get('proof', ''))
@route('POST', '/api/reports', limit=(20, 3600))
def report(c: Ctx): _assist_on(); return 201, c.app.reports.submit(c.user, c.body, c.reporter_key, _img(c))
@route('GET', '/api/reports/mine', auth='user')
def reports_mine(c: Ctx): return c.app.reports.mine(c.user)
@route('GET', '/api/reports/summary')
def reports_summary(c: Ctx): return c.app.reports.public_summary()

# ---- admin --------------------------------------------------------------------------------------------------------------------
@route('GET', '/api/admin/dashboard', auth='admin')
def dash(c: Ctx):
    a = c.app; db = a.db; a.closures.refresh(); today = dt.datetime.now(jobs.IST).date()
    busy = []
    if a.predictor.status().get('model_loaded'):
        busy = [i for i in a.crowd.busiest(today.isoformat(), '9', 5)] + [i for i in a.crowd.busiest(today.isoformat(), '18', 5)]
    one = lambda q, *p: db.one(q, p)['n']
    return dict(active_alerts=one("SELECT COUNT(*) n FROM service_alerts WHERE status='ACTIVE'"), verified_disruptions=one("SELECT COUNT(*) n FROM service_alerts WHERE status='ACTIVE' AND verification_status IN ('VERIFIED','OFFICIAL_FEED') AND category IN ('DISRUPTION','PARTIAL_DISRUPTION','CLOSURE')"),
                unverified_alerts=one("SELECT COUNT(*) n FROM service_alerts WHERE status='ACTIVE' AND verification_status='UNVERIFIED'"), active_closures=one("SELECT COUNT(*) n FROM closures WHERE status IN ('ACTIVE','EXTENDED')"), scheduled_closures=one("SELECT COUNT(*) n FROM closures WHERE status='SCHEDULED'"),
                unverified_reports=one("SELECT COUNT(*) n FROM passenger_reports WHERE status IN ('SUBMITTED','UNDER_REVIEW')"), lost_open=one("SELECT COUNT(*) n FROM lost_items WHERE status NOT IN ('RETURNED','CLOSED')"), found_open=one("SELECT COUNT(*) n FROM found_items WHERE status NOT IN ('RETURNED','CLOSED')"),
                possible_matches=one("SELECT COUNT(*) n FROM lost_found_matches WHERE status IN ('POSSIBLE_MATCH','UNDER_REVIEW')"), pending_claims=one("SELECT COUNT(*) n FROM lost_found_matches WHERE status='CLAIM_PENDING'"),
                predicted_high_demand=busy, sources=a.sources.list(), feed=a.sources.live_status(), last_successful_refresh=db.one('SELECT MAX(last_success) m FROM data_sources')['m'], crowd=a.crowd.status())
@route('GET', '/api/admin/alerts', auth='admin')
def a_alerts(c: Ctx): return dict(alerts=c.app.alerts.list(public=False, line=c.query.get('line'), status=c.query.get('status')))
@route('POST', '/api/admin/alerts', auth='admin')
def a_alert_new(c: Ctx): return 201, c.app.alerts.create(c.user, c.body)
@route('POST', '/api/admin/alerts/preview-notification', auth='admin')
def a_alert_prev(c: Ctx):
    v, st, segs = c.app.alerts._validate(c.body); a = dict(stations=st, line_id=v['line_id'], category=v['category'], segments=segs)
    uids = c.app.notifier.audience(stations=st, line=v['line_id'], kinds=('station', 'line', 'delays', 'closures')) | c.app.alerts.affected_journey_users(a)
    return dict(audience=len(uids), title=v['title'], body=(v['description'] or v['reason'] or '')[:300], note='Notifications are sent only once the alert is VERIFIED.')
@route('PATCH', '/api/admin/alerts/{id}', auth='admin')
def a_alert_upd(c: Ctx): return c.app.alerts.update(c.user, int(c.params['id']), c.body)
@route('POST', '/api/admin/alerts/{id}/resolve', auth='admin')
def a_alert_res(c: Ctx): return c.app.alerts.resolve(c.user, int(c.params['id']), c.body.get('note'))
@route('GET', '/api/admin/closures', auth='admin')
def a_cl(c: Ctx): return dict(closures=c.app.closures.list(c.query.get('status')))
@route('POST', '/api/admin/closures/preview', auth='admin')
def a_cl_prev(c: Ctx): return c.app.closures.preview(c.body)
@route('POST', '/api/admin/closures', auth='admin')
def a_cl_new(c: Ctx): return 201, c.app.closures.create(c.user, c.body)
@route('PATCH', '/api/admin/closures/{id}', auth='admin')
def a_cl_mod(c: Ctx): return c.app.closures.modify(c.user, int(c.params['id']), c.body)
@route('POST', '/api/admin/closures/{id}/cancel', auth='admin')
def a_cl_cancel(c: Ctx): return c.app.closures.cancel(c.user, int(c.params['id']))
@route('POST', '/api/admin/closures/{id}/resolve', auth='admin')
def a_cl_res(c: Ctx): return c.app.closures.resolve(c.user, int(c.params['id']))
@route('GET', '/api/admin/reports', auth='admin')
def a_reports(c: Ctx): return dict(reports=c.app.reports.admin_list(c.query.get('status')))
@route('PATCH', '/api/admin/reports/{id}', auth='admin')
def a_report_set(c: Ctx): need(c.body, 'status'); return c.app.reports.set_status(c.user, int(c.params['id']), c.body['status'], c.body.get('note'))
@route('POST', '/api/admin/reports/merge', auth='admin')
def a_report_merge(c: Ctx): return c.app.reports.merge(c.user, [int(i) for i in c.body.get('ids', [])])
@route('GET', '/api/admin/lost-found', auth='admin')
def a_lf(c: Ctx): return c.app.lf.admin_items()
@route('PATCH', '/api/admin/lost-found/matches/{id}', auth='admin')
def a_lf_match(c: Ctx): need(c.body, 'status'); return c.app.lf.transition(c.user, int(c.params['id']), c.body['status'], c.body.get('note'), c.body.get('handover_note'))
@route('POST', '/api/admin/lost-found/reject', auth='admin')
def a_lf_reject(c: Ctx): need(c.body, 'kind', 'id'); return c.app.lf.reject_report(c.user, c.body['kind'], int(c.body['id']), c.body.get('note', ''))
@route('GET', '/api/admin/lost-found/history/{kind}/{id}', auth='admin')
def a_lf_hist(c: Ctx): return c.app.lf.history(c.params['kind'], int(c.params['id']))
@route('GET', '/api/admin/lost-found/weights', auth='admin')
def a_lf_w(c: Ctx): return c.app.lf.weights()
@route('PUT', '/api/admin/lost-found/weights', auth='admin')
def a_lf_w_set(c: Ctx): return c.app.lf.set_weights(c.user, c.body)
@route('GET', '/api/admin/data-sources', auth='admin')
def a_src(c: Ctx): return dict(sources=c.app.sources.list(), feed=c.app.sources.live_status(), logs=c.app.sources.logs(limit=40))
@route('POST', '/api/admin/data-sources/refresh', auth='admin')
def a_src_ref(c: Ctx): return dict(results=c.app.sources.refresh())
@route('POST', '/api/admin/data-sources/{id}/verify', auth='admin')
def a_src_ver(c: Ctx): return c.app.sources.mark_verified(c.user, c.params['id'], c.body.get('note', ''))
@route('POST', '/api/admin/events', auth='admin')
def a_event(c: Ctx): return 201, c.app.crowd.create_event(c.user, c.body)
@route('POST', '/api/admin/emergency/{id}/verify', auth='admin')
def a_em_ver(c: Ctx):
    c.app.db.x("UPDATE emergency_contacts SET verification_status='VERIFIED_BY_ADMIN', last_verified_at=? WHERE id=?", (utcnow(), int(c.params['id']))); c.app.db.audit(c.user['id'], 'emergency.verify', 'contact', c.params['id'], c.body); return dict(ok=True)
@route('GET', '/api/admin/audit', auth='admin')
def a_audit(c: Ctx): return c.app.db.q('SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT 200')
@route('POST', '/api/admin/jobs/run', auth='admin')
def a_jobs(c: Ctx): return jobs.run_all(c.app)
@route('GET', '/api/admin/model', auth='admin')
def a_model(c: Ctx):
    from ..core.config import ROOT
    rpt = ROOT/'data'/'metro'/'metadata'/'model_report.json'; return dict(status=c.app.crowd.status(), report=json.load(open(rpt)) if rpt.exists() else None)
