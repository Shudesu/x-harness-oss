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
