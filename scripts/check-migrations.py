from pathlib import Path
import sqlite3
root=Path(__file__).resolve().parent.parent
db=sqlite3.connect(':memory:')
for path in sorted((root/'packages/db/bootstrap').glob('*.sql')):
    db.executescript(path.read_text())
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
for migration in (root/'packages/db/migrations').glob('*.sql'):
    copy=root/'packages/db/bootstrap'/migration.name
    if copy.exists(): assert copy.read_text()==migration.read_text(), migration.name
print('Fresh install schema and upgrade migration verified')

# schema.sql is the current fresh-install snapshot, not a pre-gates legacy copy.
fresh=sqlite3.connect(':memory:')
fresh.executescript((root/'packages/db/schema.sql').read_text())
tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
assert set(tables)=={r[0] for r in fresh.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
for table in tables:
    assert db.execute(f'PRAGMA table_info("{table}")').fetchall()==fresh.execute(f'PRAGMA table_info("{table}")').fetchall(),table
assert {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}=={r[0] for r in fresh.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
print('Current schema snapshot matches all bootstrap tables, columns and triggers')
