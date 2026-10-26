from pathlib import Path
import sqlite3
root=Path(__file__).resolve().parent.parent
db=sqlite3.connect(':memory:')
for path in sorted((root/'packages/db/bootstrap').glob('*.sql')):
    db.executescript(path.read_text())
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert (root/'packages/db/bootstrap/019-security-cost-ai.sql').read_text()==(root/'packages/db/migrations/019-security-cost-ai.sql').read_text()
print('Fresh install schema and upgrade migration verified')
