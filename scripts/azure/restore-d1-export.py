"""Restore a D1 SQL export to a NEW SQLite file; never overwrite a snapshot."""
import os, sqlite3, sys
source, target = sys.argv[1:]
fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
os.close(fd)
connection = sqlite3.connect(target)
try:
    with open(source, encoding='utf-8') as export:
        connection.execute('PRAGMA foreign_keys=OFF')
        connection.executescript('BEGIN;\n' + export.read() + '\nCOMMIT;')
    assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert not connection.execute('PRAGMA foreign_key_check').fetchall()
    print('D1 export restored and integrity checked; source export unchanged.')
finally:
    connection.close()
