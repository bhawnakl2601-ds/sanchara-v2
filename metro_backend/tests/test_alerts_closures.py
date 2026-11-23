import json
from .conftest import iso
from metro_backend.app.services.alerts import delay_label, compute_delay

PURPLE = dict(line_id='PURPLE', stations=['MAGR' if False else 'MAGR', 'CBPK'])

def mk(c, admin, **kw):
    d = dict(category='DELAY', title='Delay on Purple Line', line_id='PURPLE', delay_minutes=7, stations=['MAGR', 'CBPK'], reason='Signalling check', source_url='https://english.bmrc.co.in/', verify=True); d.update(kw)
    return c.call('POST', '/api/admin/alerts', d, admin)

def test_delay_thresholds_and_formula():
    assert [delay_label(x) for x in (1, 4, 8, 15)] == ['NORMAL', 'MINOR', 'MODERATE', 'MAJOR']
    assert compute_delay('2025-01-01T10:00:00+00:00', '2025-01-01T10:07:30+00:00') == 7.5
    assert delay_label(None) is None            # no feed -> no inferred delay

def test_valid_official_alert_visible_and_listed(c, admin):
    s, a = mk(c, admin); assert s == 201 and a['verification_status'] == 'VERIFIED' and a['delay_level'] == 'MODERATE'
    s, d = c.call('GET', '/api/alerts/active'); assert [x['id'] for x in d['alerts']] == [a['id']]
    assert d['feed']['live_connected'] is False and 'not connected' in d['feed']['message']       # never presented as live
    s, d = c.call('GET', '/api/alerts', query={'line': 'GREEN'}); assert d['alerts'] == []

def test_unverified_alert_hidden_from_passengers(c, admin):
    s, a = mk(c, admin, verify=False); assert a['verification_status'] == 'UNVERIFIED'
    assert c.call('GET', '/api/alerts/active')[1]['alerts'] == []
    assert c.call('GET', f"/api/alerts/{a['id']}")[0] == 404

def test_verify_requires_source(c, admin):
    s, d = mk(c, admin, source_url=None, verify=True); assert s == 422

def test_duplicate_alert_rejected(c, admin):
    assert mk(c, admin)[0] == 201; s, d = mk(c, admin); assert s == 409 and 'existing_id' in d

def test_update_then_resolve_and_expired(c, admin, app):
    s, a = mk(c, admin, expected_end_at=iso(-1))
    s, u = c.call('PATCH', f"/api/admin/alerts/{a['id']}", dict(delay_minutes=12), admin); assert u['delay_level'] == 'MAJOR'
    assert app.alerts.expire() == 1 and c.call('GET', f"/api/alerts/{a['id']}")[1]['status'] == 'RESOLVED'
    s, b = mk(c, admin, title='Another', expected_end_at=None); s, r = c.call('POST', f"/api/admin/alerts/{b['id']}/resolve", dict(note='restored'), admin); assert r['status'] == 'RESOLVED'
    assert c.call('POST', f"/api/admin/alerts/{b['id']}/resolve", {}, admin)[0] == 409

def test_stale_source_flag(c, admin, app):
    s, a = mk(c, admin); app.db.x("UPDATE service_alerts SET source_id='bmrcl_gtfs_rt_alerts' WHERE id=?", (a['id'],)); app.db.x("UPDATE data_sources SET status='AUTH_REQUIRED' WHERE id='bmrcl_gtfs_rt_alerts'")
    app.db.x("UPDATE data_sources SET status='STALE' WHERE id='bmrcl_gtfs_rt_alerts'")
    assert 'stale_warning' in c.call('GET', f"/api/alerts/{a['id']}")[1]

def test_unknown_station_and_line_rejected(c, admin):
    assert mk(c, admin, stations=['NOPE'])[0] == 422 and mk(c, admin, line_id='RED', title='x')[0] == 422

# ---- closures --------------------------------------------------------------------------------------------------------------
def cl(c, admin, **kw):
    d = dict(type='STATION_CLOSURE', station_id='CBPK', reason='Maintenance', start_at=iso(-1), end_at=iso(5), source_url='https://english.bmrc.co.in/'); d.update(kw); return c.call('POST', '/api/admin/closures', d, admin)

def test_station_closure_pass_through_semantics(c, admin):
    s, x = cl(c, admin); assert s == 201 and x['status'] == 'ACTIVE'
    r = c.call('GET', '/api/routes/restrictions')[1]; assert r['closedStations'] == [dict(id='CBPK', passThrough=True, closureId=x['id'])]
    # a journey passing THROUGH a pass-through closed station is fine; one that stops there is hit
    thru = [dict(line='PURPLE', stations=['MAGR', 'CBPK', 'VDSA'])]; stop = [dict(line='PURPLE', stations=['MAGR', 'CBPK'])]
    assert c.call('POST', '/api/routes/impact', dict(legs=thru))[1]['affected'] is False
    assert c.call('POST', '/api/routes/impact', dict(legs=stop))[1]['affected'] is True
    s, y = cl(c, admin, station_id='VDSA', trains_pass_through=False); thru2 = [dict(line='PURPLE', stations=['CBPK', 'VDSA', 'VSWA'])]
    assert c.call('POST', '/api/routes/impact', dict(legs=thru2))[1]['affected'] is True       # trains do not run through

def test_section_line_partial_interchange(c, admin):
    s, a = cl(c, admin, type='TRACK_SECTION_CLOSURE', station_id=None, line_id='PURPLE', from_station='MAGR', to_station='VDSA')
    r = c.call('GET', '/api/routes/restrictions')[1]; assert len(r['closedSegments']) == 2 and all(g['line'] == 'PURPLE' for g in r['closedSegments'])
    leg = [dict(line='PURPLE', stations=['IDN', 'MAGR', 'CBPK', 'VDSA', 'VSWA'])]; assert c.call('POST', '/api/routes/impact', dict(legs=leg))[1]['affected']
    assert not c.call('POST', '/api/routes/impact', dict(legs=[dict(line='PURPLE', stations=['BYPH', 'SVRD'])]))[1]['affected']
    s, b = cl(c, admin, type='LINE_SUSPENSION', station_id=None, line_id='GREEN'); assert c.call('POST', '/api/routes/impact', dict(legs=[dict(line='GREEN', stations=['NGSA', 'DSH'])]))[1]['affected']
    s, p = cl(c, admin, type='PARTIAL_SERVICE', station_id=None, line_id='YELLOW', from_station='RVR', to_station='JDHP')
    assert p['status'] == 'ACTIVE'; far = [dict(line='YELLOW', stations=['BMSD', 'HBGI'])]; assert c.call('POST', '/api/routes/impact', dict(legs=far))[1]['affected']
    s, i = cl(c, admin, type='INTERCHANGE_CLOSURE', station_id='KGWA')
    two = [dict(line='GREEN', stations=['NGSA', 'KGWA']), dict(line='PURPLE', stations=['KGWA', 'MIRD'])]; assert c.call('POST', '/api/routes/impact', dict(legs=two))[1]['affected']

def test_lifecycle_scheduled_active_extended_resolved_cancelled(c, admin, app):
    s, x = cl(c, admin, start_at=iso(2), end_at=iso(6)); assert x['status'] == 'SCHEDULED'
    assert c.call('GET', '/api/routes/restrictions')[1]['closedStations'] == []             # scheduled closures do not alter the graph
    app.db.x("UPDATE closures SET start_at=? WHERE id=?", (iso(-1), x['id'])); app.closures.refresh(); assert app.closures.get(x['id'])['status'] == 'ACTIVE'
    s, e = c.call('PATCH', f"/api/admin/closures/{x['id']}", dict(end_at=iso(10)), admin); assert e['status'] == 'EXTENDED' and e['extended_count'] == 1
    app.db.x("UPDATE closures SET end_at=? WHERE id=?", (iso(-0.01), x['id'])); app.closures.refresh(); assert app.closures.get(x['id'])['status'] == 'RESOLVED'
    assert c.call('GET', '/api/routes/restrictions')[1]['closedStations'] == []
    s, y = cl(c, admin, start_at=iso(3), end_at=iso(4)); s, z = c.call('POST', f"/api/admin/closures/{y['id']}/cancel", {}, admin); assert z['status'] == 'CANCELLED'
    assert c.call('POST', f"/api/admin/closures/{y['id']}/resolve", {}, admin)[0] == 409

def test_closure_mirrors_alert_and_closes_with_it(c, admin, app):
    s, x = cl(c, admin); al = c.call('GET', '/api/alerts/active')[1]['alerts']; assert len(al) == 1 and al[0]['category'] == 'CLOSURE' and 'CBPK' in al[0]['stations']
    c.call('POST', f"/api/admin/closures/{x['id']}/resolve", {}, admin); assert c.call('GET', '/api/alerts/active')[1]['alerts'] == []

def test_closure_validation_and_preview(c, admin):
    assert cl(c, admin, source_url=None)[0] == 422                                  # official source required
    assert cl(c, admin, end_at=iso(-5))[0] == 422 and cl(c, admin, station_id='ZZZ')[0] == 422
    assert cl(c, admin, type='TRACK_SECTION_CLOSURE', station_id=None, line_id='PURPLE', from_station='NGSA', to_station='DSH')[0] == 422   # stations not on that line
    assert cl(c, admin, type='INTERCHANGE_CLOSURE', station_id='CBPK')[0] == 422                                                              # not an interchange
    tok, uid = c.register(); c.call('POST', '/api/journeys', dict(origin='MAGR', destination='CBPK', legs=[dict(line='PURPLE', stations=['MAGR', 'CBPK'])]), tok)
    s, p = c.call('POST', '/api/admin/closures/preview', dict(type='STATION_CLOSURE', station_id='CBPK', reason='x', start_at=iso(1), source_note='note'), admin); assert p['saved_journeys_affected'] == 1
    assert c.call('GET', '/api/closures/active')[1]['closures'] == []               # preview publishes nothing


def test_lift_outage_is_step_free_only_restriction(c, admin):
    s, d = cl(c, admin, type='LIFT_OUTAGE', station_id='CBPK', reason='Lift under repair'); assert s == 201, d
    c.call('POST', f"/api/admin/closures/{d['id']}/activate", {}, admin)
    r = c.call('GET', '/api/routes/restrictions')[1]
    assert [x['id'] for x in r['liftOutages']] == ['CBPK'] and r['closedStations'] == []      # station stays open to everyone else
    s, e = cl(c, admin, type='ESCALATOR_OUTAGE', station_id='MAGR', reason='Escalator'); assert s == 201
    c.call('POST', f"/api/admin/closures/{e['id']}/activate", {}, admin)
    r = c.call('GET', '/api/routes/restrictions')[1]; assert [x['id'] for x in r['liftOutages']] == ['CBPK'] and r['closedStations'] == []
