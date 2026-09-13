#!/usr/bin/env python3
"""Export a read-only SQLite snapshot into bounded D1 SQL; validate in a temp DB.
Usage: python3 scripts/prepare-d1-transfer.py BACKUP.sqlite IGNORED_OUTPUT_DIR
Remote import is intentionally a separate, explicitly targeted Wrangler command.
"""
import json, pathlib, sqlite3, sys, tempfile
source, output = pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2]).resolve()
if output.exists():
    raise SystemExit('Choose a new output directory; existing exports are never overwritten')
output.mkdir(parents=True, mode=0o700)
db = sqlite3.connect(f'file:{source}?mode=ro', uri=True)
quote_id = lambda value: '"' + value.replace('"', '""') + '"'
def literal(value):
    if value is None: return 'NULL'
    if isinstance(value, bytes): return "X'" + value.hex() + "'"
    if isinstance(value, str):
        if '\x00' in value: return "CAST(X'" + value.encode().hex() + "' AS TEXT)"
        return "'" + value.replace("'", "''") + "'"
    return str(value)
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")]
# Cache bodies may contain credential-bearing provider URLs; regenerate in production.
excluded = {'http_response_cache': 'rebuildable provider response cache', 'sync_locks': 'local process leases'}
# Badge metadata is currently stored only in this cache row; it is durable content.
filters = {'football_cache': " WHERE id='public-badges'"}
counts = {t: db.execute('SELECT count(*) FROM '+quote_id(t)).fetchone()[0] for t in tables}
# Parents precede children. No foreign keys are disabled in the verification DB.
ordered=[]
def visit(t, visiting):
    if t in ordered or t in excluded: return
    if t in visiting: raise RuntimeError('Foreign key cycle: '+t)
    for row in db.execute('PRAGMA foreign_key_list('+quote_id(t)+')'):
        if row[2] != t: visit(row[2], visiting | {t})
    ordered.append(t)
for t in tables: visit(t,set())
manifest={'source':str(source),'bytes':source.stat().st_size,'local':counts,'exported':{},'skipped':{t:{'count':counts[t],'reason':why} for t,why in excluded.items()},'failed':0,'files':[]}
if 'football_cache' in counts:
    kept = db.execute("SELECT count(*) FROM football_cache WHERE id='public-badges'").fetchone()[0]
    manifest['skipped']['football_cache'] = {'count': counts['football_cache']-kept, 'reason': 'rebuildable caches; saved public badge metadata retained'}
with tempfile.TemporaryDirectory(prefix='mnemba-transfer-') as temp:
    check=sqlite3.connect(pathlib.Path(temp)/'verify.sqlite')
    check.execute('PRAGMA foreign_keys=ON')
    for migration in sorted(pathlib.Path('drizzle').glob('*.sql')): check.executescript(migration.read_text())
    current=None;size=0;index=0
    def emit(sql):
        global current,size,index
        sql=sql+';\n'
        if len(sql.encode())>=100000: raise RuntimeError('SQL statement exceeds D1 limit')
        # Bound file sizes, but never split a logical row's staging SQL from its insert.
        if current is None:
            name=f'data-{index:04}.sql';index+=1
            current=(output/name).open('w');manifest['files'].append(name)
        current.write(sql);size+=len(sql.encode());check.execute(sql)
    emit('CREATE TABLE IF NOT EXISTS _mnemba_transfer_chunks(cell TEXT,ordinal INTEGER,part TEXT,PRIMARY KEY(cell,ordinal))')
    for t in ordered:
        columns=[r[1] for r in db.execute('PRAGMA table_info('+quote_id(t)+')')]
        inserted=0
        for row in db.execute('SELECT * FROM '+quote_id(t)+filters.get(t,'')):
            values=[literal(v) for v in row]
            prefix='INSERT INTO '+quote_id(t)+'('+','.join(map(quote_id,columns))+') VALUES('
            statement=prefix+','.join(values)+')'
            if len(statement.encode())>=90000:
                values=[]
                for i,value in enumerate(row):
                    encoded=literal(value)
                    if isinstance(value,str) and len(encoded.encode())>8000:
                        cell=f'{t}:{inserted}:{i}'
                        for n, offset in enumerate(range(0,len(value),4000)):
                            emit('INSERT INTO _mnemba_transfer_chunks VALUES('+literal(cell)+','+str(n)+','+literal(value[offset:offset+4000])+')')
                        values.append("(SELECT group_concat(part,'') FROM (SELECT part FROM _mnemba_transfer_chunks WHERE cell="+literal(cell)+' ORDER BY ordinal))')
                    else: values.append(encoded)
                statement=prefix+','.join(values)+')'
            emit(statement)
            if len(statement.encode())<90000 and any(v.startswith('(SELECT group_concat') for v in values): emit('DELETE FROM _mnemba_transfer_chunks')
            inserted+=1
            if size>4_000_000:
                current.close();current=None;size=0
        manifest['exported'][t]=inserted
    emit('DROP TABLE _mnemba_transfer_chunks')
    if current:current.close()
    assert not check.execute('PRAGMA foreign_key_check').fetchall()
    assert check.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    manifest['verified']={t:check.execute('SELECT count(*) FROM '+quote_id(t)).fetchone()[0] for t in ordered}
    assert manifest['verified']==manifest['exported']
    # Compare every cell, including large immutable prediction/evidence fields.
    for t in ordered:
        columns=[r[1] for r in db.execute('PRAGMA table_info('+quote_id(t)+')')]
        query='SELECT * FROM '+quote_id(t)+filters.get(t,'')+' ORDER BY '+','.join(map(quote_id,columns))
        for a,b in zip(db.execute(query),check.execute(query),strict=True):
            assert a==b, 'Data differs: '+t
    check.close()
(output/'manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'directory':str(output),'exported':sum(manifest['exported'].values()),'skipped':manifest['skipped'],'failed':0,'files':len(manifest['files']),'verified':'all cells and foreign keys'}))
