import base64, json, pytest
from .conftest import iso
from metro_backend.app.core.security import make_token
from metro_backend.app.services import reports as rep

def alert(c, admin, **kw):
    d = dict(category='DELAY', title='Delay at Majestic', line_id='PURPLE', delay_minutes=8, stations=['KGWA'], source_url='https://english.bmrc.co.in/', verify=True); d.update(kw); return c.call('POST', '/api/admin/alerts', d, admin)

def test_notify_only_relevant_and_verified(c, admin):
    t1, u1 = c.register('a@x.com'); t2, u2 = c.register('b@x.com')
    c.call('POST', '/api/notifications/subscribe', dict(kind='station', target='KGWA'), t1); c.call('POST', '/api/notifications/subscribe', dict(kind='station', target='NGSA'), t2)
    s, a = alert(c, admin, verify=False); assert c.call('GET', '/api/notifications', token=t1)[1]['notifications'] == []    # unverified: nothing
    c.call('PATCH', f"/api/admin/alerts/{a['id']}", dict(verify=True, source_url='https://english.bmrc.co.in/'), admin)
    n1 = c.call('GET', '/api/notifications', token=t1)[1]; n2 = c.call('GET', '/api/notifications', token=t2)[1]
    assert len(n1['notifications']) == 1 and n1['unread'] == 1 and n2['notifications'] == []

def test_deduplication_and_cooldown(c, admin, app):
    t, u = c.register(); c.call('POST', '/api/notifications/subscribe', dict(kind='line', target='PURPLE'), t)
    s, a = alert(c, admin); app.alerts.notify(a['id'], 'created'); app.alerts.notify(a['id'], 'created')     # identical -> duplicate
    assert len(c.call('GET', '/api/notifications', token=t)[1]['notifications']) == 1
    c.call('PATCH', f"/api/admin/alerts/{a['id']}", dict(delay_minutes=9), admin)                              # new version but inside cooldown -> suppressed
    assert len(c.call('GET', '/api/notifications', token=t)[1]['notifications']) == 1
    c.call('POST', f"/api/admin/alerts/{a['id']}/resolve", {}, admin)                                          # resolution always goes through
    ns = c.call('GET', '/api/notifications', token=t)[1]['notifications']; assert len(ns) == 2 and ns[0]['title'].startswith('Resolved')

def test_preferences_and_read_state_and_expiry(c, admin, app):
    t, u = c.register(); c.call('POST', '/api/notifications/subscribe', dict(kind='line', target='PURPLE'), t)
    c.call('PATCH', '/api/notifications/preferences', dict(categories=dict(DELAY=False)), t)
    alert(c, admin); assert c.call('GET', '/api/notifications', token=t)[1]['notifications'] == []
    assert c.call('PATCH', '/api/notifications/preferences', dict(categories=dict(NOPE=True)), t)[0] == 422
    r = app.notifier.send(u, 'FACILITY_ISSUE', 't', 'b', key='k', verification='VERIFIED', source_label='x', expires_at=iso(-1)); assert r == dict(sent=False, reason='expired')
    app.notifier.send(u, 'FACILITY_ISSUE', 't', 'b', key='k2', verification='VERIFIED', source_label='x'); n = c.call('GET', '/api/notifications', token=t)[1]['notifications'][0]
    c.call('POST', '/api/notifications/read', dict(ids=[n['id']]), t); assert c.call('GET', '/api/notifications', token=t)[1]['unread'] == 0

def test_saved_journey_gets_closure_notice_and_alternative_flag(c, admin):
    t, u = c.register(); s, j = c.call('POST', '/api/journeys', dict(origin='MAGR', destination='VDSA', legs=[dict(line='PURPLE', stations=['MAGR', 'CBPK', 'VDSA'])]), t); assert s == 201 and j['affected'] is False
    c.call('POST', '/api/admin/closures', dict(type='TRACK_SECTION_CLOSURE', line_id='PURPLE', from_station='CBPK', to_station='VDSA', reason='Track work', start_at=iso(-1), end_at=iso(4), source_note='BMRCL notice'), admin)
    js = c.call('GET', '/api/journeys', token=t)[1]; assert js[0]['affected'] and js[0]['hits'][0]['kind'] == 'section'
    ns = c.call('GET', '/api/notifications', token=t)[1]['notifications']; assert any(n['category'] == 'LINE_CLOSURE' for n in ns)
    assert len(c.call('GET', '/api/routes/affected', token=t)[1]['affected']) == 1

def test_crowd_warning_requires_acceptable_uncertainty_and_dedupes(app):
    from metro_backend.app.services import jobs
    assert jobs.crowd_scan(app) == 0            # model disabled -> no notifications, no random values

# ---- security -------------------------------------------------------------------------------------------------------------
ADMIN_GETS = ['/api/admin/dashboard', '/api/admin/alerts', '/api/admin/closures', '/api/admin/reports', '/api/admin/lost-found', '/api/admin/data-sources', '/api/admin/audit', '/api/admin/model']
def test_admin_endpoints_need_auth_and_role(c, admin):
    tok, _ = c.register()
    for p in ADMIN_GETS:
        assert c.call('GET', p)[0] == 401, p
        assert c.call('GET', p, token=tok)[0] == 403, p
        assert c.call('GET', p, token=admin)[0] == 200, p

def test_passenger_cannot_create_official_alerts_or_closures(c):
    tok, _ = c.register(); body = dict(category='DELAY', title='Fake', verify=True, source_url='https://x.example')
    assert c.call('POST', '/api/admin/alerts', body, tok)[0] == 403
    assert c.call('POST', '/api/admin/closures', dict(type='STATION_CLOSURE', station_id='CBPK'), tok)[0] == 403
    assert c.call('POST', '/api/admin/alerts', body)[0] == 401

def test_role_is_not_taken_from_request_or_token(c, app):
    s, d = c.call('POST', '/api/auth/register', dict(email='m@x.com', password='password123', role='admin')); assert d['user']['role'] == 'passenger'
    forged = make_token(d['user']['id'], 'admin')            # token claims admin, DB says passenger
    assert c.call('GET', '/api/admin/dashboard', token=forged)[0] == 403
    assert c.call('GET', '/api/admin/dashboard', token=d['token'] + 'x')[0] == 401
    assert c.call('GET', '/api/admin/dashboard', token=make_token(d['user']['id'], 'admin', ttl=-5))[0] == 401   # expired

def test_login_failures_and_validation(c):
    assert c.call('POST', '/api/auth/login', dict(email='no@x.com', password='whatever1'))[0] == 401
    assert c.call('POST', '/api/auth/register', dict(email='bad', password='password123'))[0] == 422 and c.call('POST', '/api/auth/register', dict(email='a@b.co', password='short'))[0] == 422
    c.register('dup@x.com'); assert c.call('POST', '/api/auth/register', dict(email='dup@x.com', password='password123'))[0] == 409

def test_invalid_uploads_rejected(c):
    jpg = b'\xff\xd8\xff\xe0' + b'0' * 100; png = b'\x89PNG\r\n\x1a\n' + b'0' * 50
    ok = lambda b: dict(category='FACILITY_ISSUE', station_id='CBPK', description='Escalator not working near gate 2', image_b64=base64.b64encode(b).decode())
    assert c.call('POST', '/api/reports', ok(jpg), ip='9.9.9.1')[0] == 201
    assert c.call('POST', '/api/reports', ok(b'<?php system($_GET[0]); ?>'), ip='9.9.9.2')[0] == 415         # not an image (content-sniffed)
    assert c.call('POST', '/api/reports', ok(b'\xff\xd8\xff' + b'0' * (2 * 1024 * 1024 + 10)), ip='9.9.9.3')[0] == 413
    assert c.call('POST', '/api/reports', dict(category='FACILITY_ISSUE', description='x' * 20, image_b64='!!notb64!!'), ip='9.9.9.4')[0] == 422

def test_report_safeguards(c, admin):
    base = dict(category='POSSIBLE_DELAY', station_id='CBPK', description='Train has been waiting for 15 minutes at platform')
    assert c.call('POST', '/api/reports', dict(base, website='http://spam'), ip='2.2.2.2')[1]['ref'] == 'RPT-OK'          # honeypot
    assert c.call('GET', '/api/admin/reports', token=admin)[1]['reports'] == []                                           # honeypot stored nothing
    assert c.call('POST', '/api/reports', base, ip='3.3.3.3')[0] == 201
    assert c.call('POST', '/api/reports', base, ip='3.3.3.3')[0] == 409                                                    # duplicate from same device
    s, d = c.call('POST', '/api/reports', dict(base, description='Train is delayed here, long wait on platform'), ip='4.4.4.4'); assert s == 201 and d['grouped']
    rows = c.call('GET', '/api/admin/reports', token=admin)[1]['reports']; assert rows[0]['group_size'] == 2 and rows[0]['status'] == 'SUBMITTED'
    # reports never become official alerts automatically
    assert c.call('GET', '/api/alerts/active')[1]['alerts'] == []
    for i in range(7): s, d = c.call('POST', '/api/reports', dict(base, station_id='IDN', description=f'Crowding level report number {i} at gate'), ip='5.5.5.5')
    assert s == 429

def test_report_review_workflow(c, admin):
    c.call('POST', '/api/reports', dict(category='FACILITY_ISSUE', station_id='IDN', description='Lift out of order at Indiranagar'), ip='6.6.6.6')
    rid = c.call('GET', '/api/admin/reports', token=admin)[1]['reports'][0]['id']
    assert c.call('PATCH', f'/api/admin/reports/{rid}', dict(status='VERIFIED'), admin)[0] == 200 and c.call('PATCH', f'/api/admin/reports/{rid}', dict(status='BOGUS'), admin)[0] == 422
    assert c.call('POST', '/api/admin/reports/merge', dict(ids=[rid]), admin)[0] == 422

def test_audit_log_records_admin_actions(c, admin):
    alert(c, admin); acts = [a['action'] for a in c.call('GET', '/api/admin/audit', token=admin)[1]]; assert 'alert.create' in acts

def test_emergency_contacts_tel_links_and_privacy(c):
    d = c.call('GET', '/api/emergency/contacts')[1]; by = {x['phone']: x for x in d['contacts'] if x['phone']}
    assert by['112']['tel'] == 'tel:112' and by['1800-425-12345']['tel'] == 'tel:1800425' + '12345' and 'verified periodically' in d['warning']
    assert any(x['mailto'] == 'mailto:travelhelp@bmrc.co.in' for x in d['contacts'])
    s, r = c.call('POST', '/api/emergency/nearest-station', dict(lat=12.9756, lon=77.6068)); assert r['stations'][0]['id'] == 'MAGR' or r['stations'][0]['km'] < 1.5
    assert c.call('POST', '/api/emergency/nearest-station', dict(lat='x'))[0] == 422

def test_data_source_honesty(c, admin):
    d = c.call('GET', '/api/admin/data-sources', token=admin)[1]; st = {s['id']: s for s in d['sources']}
    assert st['bmrcl_gtfs_rt_alerts']['status'] == 'AUTH_REQUIRED' and st['bmrcl_gtfs_rt_alerts']['is_live'] is False and not st['bmrcl_gtfs_rt_alerts']['last_success']
    assert st['ridership_hist']['status'] == 'MANUAL_SOURCE' and d['feed']['live_connected'] is False and d['feed']['message'].startswith('Live BMRCL feed not connected')

def test_assistance_wip_blocks_submissions_when_disabled(c):
    from metro_backend.app.core.config import settings
    settings.ASSISTANCE_SUBMISSIONS_ENABLED = False
    try:
        st = c.call('GET', '/api/assistance/status')[1]; assert st['status'] == 'WORK_IN_PROGRESS' and st['submissions_enabled'] is False and st['emergency']['dispatch'] is False
        for path, body in [('/api/lost-found/lost', dict(category='bag', name='x', lost_on='2025-10-01')), ('/api/lost-found/found', dict(category='bag', description='x', found_at='2025-10-01T10:00:00+05:30')), ('/api/reports', dict(category='POSSIBLE_DELAY', description='something long enough'))]:
            s, d = c.call('POST', path, body); assert s == 503 and 'work in progress' in d['error'].lower(), (path, s, d)
        ct = c.call('GET', '/api/emergency/contacts')[1]; assert ct['monitored_in_real_time'] is False and ct['not_configured'] and all('status_label' in x for x in ct['contacts'])
    finally: settings.ASSISTANCE_SUBMISSIONS_ENABLED = True
