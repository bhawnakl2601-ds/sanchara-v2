"""Fresh install, restart, persistence, migration and duplicate-seed behaviour against a real on-disk SQLite file."""
import pytest
from metro_backend.app.core.database import DB, MIGRATIONS
from metro_backend.app.seed import seed_all

def counts(db): return {t: db.one(f'SELECT COUNT(*) n FROM {t}')['n'] for t in ('stations', 'metro_lines', 'metro_edges', 'emergency_contacts', 'data_sources', 'users', 'station_aliases')}

def test_first_start_creates_everything(tmp_path):
    p = tmp_path / 'fresh' / 'sanchara.db'; assert not p.exists()
    db = DB(f'sqlite:///{p}'); seed_all(db); assert p.exists()
    c = counts(db); assert c['stations'] == 83 and c['metro_lines'] == 3 and c['metro_edges'] > 80 and c['emergency_contacts'] > 0 and c['data_sources'] > 0
    assert db.one('PRAGMA journal_mode')['journal_mode'] == 'wal' and db.one('PRAGMA foreign_keys')['foreign_keys'] == 1
    assert {r['name'] for r in db.q('SELECT name FROM _migrations')} == {n for n, _ in MIGRATIONS}

def test_second_start_does_not_duplicate_seed_and_persists(tmp_path):
    p = tmp_path / 'a.db'; db = DB(f'sqlite:///{p}'); seed_all(db)
    db.x("INSERT INTO users(email,password_hash,role,created_at) VALUES('keep@me.com','x','passenger','2026-01-01')")
    first = counts(db); db.conn.close()
    db2 = DB(f'sqlite:///{p}'); seed_all(db2); seed_all(db2)             # restart + a third run
    assert {k: v for k, v in counts(db2).items() if k != 'users'} == {k: v for k, v in first.items() if k != 'users'}
    assert db2.one("SELECT COUNT(*) n FROM users WHERE email='keep@me.com'")['n'] == 1         # data written before restart survives
    assert db2.one('SELECT COUNT(*) n FROM _migrations')['n'] == len(MIGRATIONS)                # migrations ran once

def test_empty_existing_file_initialises(tmp_path):
    p = tmp_path / 'empty.db'; p.touch(); db = DB(f'sqlite:///{p}'); seed_all(db); assert counts(db)['stations'] == 83

def test_no_dependence_on_orphan_sidecars(tmp_path):
    p = tmp_path / 'x.db'; (tmp_path / 'x.db-wal').write_bytes(b''); (tmp_path / 'x.db-shm').write_bytes(b'')
    db = DB(f'sqlite:///{p}'); seed_all(db); assert counts(db)['stations'] == 83

def test_foreign_keys_enforced(tmp_path):
    import sqlite3
    db = DB(f'sqlite:///{tmp_path / "f.db"}'); seed_all(db)
    with pytest.raises(sqlite3.IntegrityError): db.x("INSERT INTO station_aliases(station_id,alias) VALUES('NOPE','x')")

def test_unsupported_or_unwritable_database_fails_with_clear_message(tmp_path):
    with pytest.raises(RuntimeError, match='SQLite'): DB('postgresql://u@h/db')
    blocker = tmp_path / 'file'; blocker.write_text('x')
    with pytest.raises(RuntimeError, match='DATABASE_URL'): DB(f'sqlite:///{blocker}/sub/x.db')           # parent is a file -> cannot create

def test_corrupt_file_reports_clear_error(tmp_path):
    p = tmp_path / 'bad.db'; p.write_bytes(b'this is not a sqlite database' * 50)
    with pytest.raises(RuntimeError, match='SQLite database'): DB(f'sqlite:///{p}')
