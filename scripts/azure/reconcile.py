"""Merge copies, retaining both versions of every conflict in an audit table."""
import sqlite3, sys, json, hashlib, os
local_path, remote_path, target, report_path = sys.argv[1:]
if os.path.exists(target): raise SystemExit('Refusing to replace an existing reconciled snapshot')
local = sqlite3.connect(f'file:{local_path}?mode=ro', uri=True)
remote = sqlite3.connect(f'file:{remote_path}?mode=ro', uri=True)
db = sqlite3.connect(target); local.backup(db); os.chmod(target, 0o600)
q = lambda s: '"' + s.replace('"','""') + '"'
# Source immutable rows are unchanged. Conflict versions are saved separately.
triggers = db.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger'").fetchall()
for name, _ in triggers: db.execute('DROP TRIGGER '+q(name))
db.execute('PRAGMA foreign_keys=OFF')
db.execute('CREATE TABLE migration_conflicts (id TEXT PRIMARY KEY, table_name TEXT NOT NULL, key_json TEXT NOT NULL, local_json TEXT NOT NULL, remote_json TEXT NOT NULL, selected_source TEXT NOT NULL)')
report = {'local':local_path,'remote':remote_path,'tables':[]}
remote.row_factory = sqlite3.Row; db.row_factory = sqlite3.Row
immutable = {r[0] for r in local.execute("SELECT DISTINCT tbl_name FROM sqlite_master WHERE type='trigger'")}
def timestamp(row):
 return max([row[k] for k in ['updated_at','last_seen_at','last_success','last_import','retrieved_at','recorded_at','published_at','created_at'] if k in row and isinstance(row[k],(int,float))] or [0])
try:
 db.execute('BEGIN')
 for (name,) in remote.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name!='d1_migrations'").fetchall():
  cols = db.execute('PRAGMA table_info('+q(name)+')').fetchall()
  if not cols: raise RuntimeError('Remote-only schema needs explicit migration: '+name)
  keys=[c['name'] for c in cols]; pk=[c['name'] for c in sorted(cols,key=lambda c:c['pk']) if c['pk']]
  if not pk: raise RuntimeError('No primary key: '+name)
  source_keys=[c[1] for c in remote.execute('PRAGMA table_info('+q(name)+')')]
  if keys!=source_keys: raise RuntimeError('Schema mismatch: '+name)
  stats={'name':name,'inserted':0,'conflicts':0,'remoteSelected':0}
  for record in remote.execute('SELECT * FROM '+q(name)):
   row=dict(record);values=[row[k] for k in keys]
   old=db.execute('SELECT * FROM '+q(name)+' WHERE '+' AND '.join(q(k)+'=?' for k in pk),[row[k] for k in pk]).fetchone()
   if old:
    old=dict(old)
    if old==row:continue
    stats['conflicts']+=1
    # Production wins immutable conflicts; otherwise retain freshest evidence.
    chosen='remote' if name in immutable or timestamp(row)>timestamp(old) else 'local'
    key=json.dumps([row[k] for k in pk]);identity=hashlib.sha256((name+key).encode()).hexdigest()
    db.execute('INSERT INTO migration_conflicts VALUES(?,?,?,?,?,?)',(identity,name,key,json.dumps(old),json.dumps(row),chosen))
    if chosen=='local':continue
    stats['remoteSelected']+=1
    change=[k for k in keys if k not in pk]
    db.execute('UPDATE '+q(name)+' SET '+','.join(q(k)+'=?' for k in change)+' WHERE '+' AND '.join(q(k)+'=?' for k in pk),[row[k] for k in change+pk])
   else:
    db.execute('INSERT INTO '+q(name)+' ('+','.join(map(q,keys))+') VALUES ('+','.join('?' for k in keys)+')',values);stats['inserted']+=1
  stats['mergedCount']=db.execute('SELECT COUNT(*) FROM '+q(name)).fetchone()[0];report['tables'].append(stats)
 for name, sql in triggers:db.execute(sql)
 violations=db.execute('PRAGMA foreign_key_check').fetchall()
 if violations:raise RuntimeError(f'{len(violations)} foreign key violations')
 db.commit()
 assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 report['conflictCount']=db.execute('SELECT COUNT(*) FROM migration_conflicts').fetchone()[0]
 with open(report_path,'w') as f:json.dump(report,f,indent=2)
 os.chmod(report_path,0o600)
 print('Merged copy verified; conflicts archived:',report['conflictCount'])
except:
 db.rollback();raise
finally:db.close();local.close();remote.close()
