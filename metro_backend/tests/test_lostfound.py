import pytest, datetime as dt
from metro_backend.app.services.lostfound import score, desc_sim, LostFound
from metro_backend.app.services.network import Network

NET = Network()
def lost(**k): return dict(dict(category='bag', name='Black laptop bag', description='black backpack with laptop, Dell sticker', colour='black', brand='Dell', lost_on='2025-09-10', lost_time='09:00', station_id='MAGR'), **k)
def found(**k): return dict(dict(category='bag', description='Black backpack with a Dell sticker and a laptop inside', colour='black', brand='Dell', station_id='MAGR', found_at='2025-09-10T10:30:00'), **k)

def test_scoring_true_vs_false_match():
    good, _ = score(lost(), found(), NET)
    bad, _ = score(lost(), found(category='umbrella', description='Red folding umbrella with wooden handle', colour='red', brand=None, station_id='NGSA'), NET)
    assert good > 0.8 and bad < 0.3 and good - bad > 0.5

def test_scoring_components():
    _, p = score(lost(), found(colour='navy'), NET); assert p['colour'] == 0.0 or p['colour'] == 0.6 and p['category'] == 1.0
    _, p = score(lost(brand=None), found(), NET); assert p['brand'] is None                      # missing info is neutral, not a penalty
    _, p = score(lost(), found(found_at='2025-09-09T08:00:00'), NET); assert p['time'] == 0.0     # cannot be found before it was lost
    s_near, _ = score(lost(), found(station_id='CBPK'), NET); s_far, _ = score(lost(), found(station_id='NGSA'), NET); assert s_near > s_far
    assert desc_sim('blue umbrella', 'blue umbrellas') > 0.5

def test_weights_are_configurable():
    a, _ = score(lost(), found(), NET, dict(description=0, colour=0, brand=0, location=0, time=0, category=1)); assert a == 1.0

def test_end_to_end_flow(c, admin, app):
    ut, uid = c.register('owner@x.com'); ot, oid = c.register('other@x.com')
    s, l = c.call('POST', '/api/lost-found/lost', dict(category='bag', name='Black laptop bag', description='black backpack with laptop, Dell sticker', colour='black', brand='Dell', lost_on='2025-09-10', lost_time='09:00', station_id='MAGR', contact='9999999999'), ut); assert s == 201 and 'contact' not in l
    s, f = c.call('POST', '/api/lost-found/found', dict(category='bag', description='Black backpack with a Dell sticker and a laptop inside', colour='black', brand='Dell', station_id='MAGR', found_at='2025-09-10T16:00:00+05:30')); assert s == 201 and f['status'] == 'FOUND_REPORTED'
    s, f2 = c.call('POST', '/api/lost-found/found', dict(category='umbrella', description='Red umbrella', colour='red', station_id='NGSA', found_at='2025-09-10T16:00:00+05:30'))
    m = c.call('GET', '/api/lost-found/matches', token=ut)[1]['matches']; assert len(m) == 1 and m[0]['label'] == 'Possible match' and m[0]['found_description'] is None     # nothing revealed yet
    assert c.call('GET', '/api/lost-found/matches', token=ot)[1]['matches'] == []                                                                                       # other users see nothing
    mid = m[0]['id']
    assert c.call('POST', '/api/lost-found/claim', dict(match_id=mid, proof='It has my initials sewn inside'), ut)[0] == 409           # cannot claim before verification
    assert c.call('PATCH', f'/api/admin/lost-found/matches/{mid}', dict(status='RETURNED'), admin)[0] == 409                           # cannot skip verification
    assert c.call('PATCH', f'/api/admin/lost-found/matches/{mid}', dict(status='VERIFIED_MATCH'), ut)[0] == 403
    assert c.call('PATCH', f'/api/admin/lost-found/matches/{mid}', dict(status='UNDER_REVIEW'), admin)[0] == 200
    assert c.call('PATCH', f'/api/admin/lost-found/matches/{mid}', dict(status='VERIFIED_MATCH', note='photo checked'), admin)[0] == 200
    m = c.call('GET', '/api/lost-found/matches', token=ut)[1]['matches'][0]; assert m['found_description'] and m['handover_note'] is None
    assert c.call('POST', '/api/lost-found/claim', dict(match_id=mid, proof='short'), ut)[0] == 422
    assert c.call('POST', '/api/lost-found/claim', dict(match_id=mid, proof='It has my initials sewn inside'), ot)[0] == 404
    assert c.call('POST', '/api/lost-found/claim', dict(match_id=mid, proof='It has my initials sewn inside'), ut)[1]['status'] == 'CLAIM_PENDING'
    c.call('PATCH', f'/api/admin/lost-found/matches/{mid}', dict(status='RETURNED', handover_note='Collect from Majestic station office, ID needed'), admin)
    m = c.call('GET', '/api/lost-found/matches', token=ut)[1]['matches'][0]; assert m['status'] == 'RETURNED' and 'Majestic' in m['handover_note']
    hist = c.call('GET', f'/api/admin/lost-found/history/match/{mid}', token=admin)[1]; assert [h['to_status'] for h in hist] == ['UNDER_REVIEW', 'VERIFIED_MATCH', 'CLAIM_PENDING', 'RETURNED']
    notes = c.call('GET', '/api/notifications', token=ut)[1]['notifications']; assert any(n['category'] == 'LOST_FOUND_UPDATE' for n in notes)

def test_false_match_rejected_returns_items_to_pool(c, admin):
    ut, _ = c.register('o@x.com'); c.call('POST', '/api/lost-found/lost', dict(category='bag', name='Black bag', colour='black', lost_on='2025-09-10', station_id='MAGR'), ut)
    c.call('POST', '/api/lost-found/found', dict(category='bag', description='Black bag', colour='black', station_id='MAGR', found_at='2025-09-10T18:00:00+05:30'))
    mid = c.call('GET', '/api/admin/lost-found', token=admin)[1]['matches'][0]['id']
    assert c.call('PATCH', f'/api/admin/lost-found/matches/{mid}', dict(status='CLOSED', note='different bag'), admin)[0] == 200
    d = c.call('GET', '/api/admin/lost-found', token=admin)[1]; assert d['lost'][0]['status'] == 'LOST_REPORTED' and d['found'][0]['status'] == 'FOUND_REPORTED'
    assert c.call('POST', '/api/admin/lost-found/reject', dict(kind='found', id=d['found'][0]['id'], note='spam'), admin)[1]['status'] == 'CLOSED'

def test_validation_and_privacy(c):
    assert c.call('POST', '/api/lost-found/lost', dict(category='spaceship', name='x', lost_on='2025-09-10'))[0] == 422
    assert c.call('POST', '/api/lost-found/lost', dict(category='bag', name='x', lost_on='10/09/2025'))[0] == 422
    assert c.call('POST', '/api/lost-found/found', dict(category='bag', description='x', found_at='2025-09-10T10:00:00', station_id='ZZZ'))[0] == 422
    assert c.call('GET', '/api/lost-found/matches')[0] == 401 and c.call('POST', '/api/lost-found/claim', dict(match_id=1))[0] == 401
