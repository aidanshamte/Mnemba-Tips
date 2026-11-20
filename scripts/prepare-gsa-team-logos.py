"""Discover image references in reviewed domestic competition tables; no match data imported."""
import json, re, time, urllib.request, hashlib, unicodedata
from pathlib import Path
from html.parser import HTMLParser
root=Path('.sites-runtime/real-logos'); audit=json.loads((root/'coverage.json').read_text())
reviewed=Path('config/reviewed-logo-candidates.json'); entries=json.loads(reviewed.read_text())
countries={'Ghana Premier League':'Ghana','Rwanda Premier League':'Rwanda','Nigeria Premier League':'Nigeria','Zambia Super League':'Zambia','Uganda Premier League':'Uganda'}
for c in audit['competitions']:
 domestic=[x for x in c['countries'] if x not in {'Africa','Asia','Europe','International','World','South America','North America','Oceania'}]
 if len(domestic)==1:countries[c['name']]=domestic[0]
def norm(s):
 s=''.join(c for c in unicodedata.normalize('NFKD',s.lower()) if not unicodedata.combining(c)).replace('ß','ss')
 return re.sub(r'[^\w]+',' ',re.sub(r'\b(fc|sc|cf|afc)\b','',s)).strip()
class Images(HTMLParser):
 def __init__(self): super().__init__();self.scopes=[];self.rows=[];self.large={}
 def handle_starttag(self,t,a):
  d=dict(a)
  if t=='div':self.scopes.append('gsa-match-standing__table' in d.get('class','').split() or bool(self.scopes and self.scopes[-1]))
  u=d.get('src',''); name=d.get('alt','')
  m=re.fullmatch(r'https://(?:www\.)?dsg-images.com/clubs/(\d+)x\d+/(\d+)\.png',u)
  if t=='img' and m and name.startswith('logo of '):
   if int(m[1])>=50:self.large[m[2]]=u
   if self.scopes and self.scopes[-1]:self.rows.append((name[8:],m[2]))
 def handle_endtag(self,t):
  if t=='div' and self.scopes:self.scopes.pop()
report=[]
extra={'Morocco':['Botola Pro','Botola 2'],'Egypt':['Premier League'],'Algeria':['Ligue 1'],'Kenya':['Kenya Premier League'],'Germany':['Bundesliga','2. Bundesliga'],'England':['Premier League','Championship'],'France':['Ligue 1','Ligue 2'],'Spain':['La Liga'],'Italy':['Serie A','Serie B'],'Brazil':['Série B'],'Argentina':['Liga Profesional de Fútbol'],'China':['Super League'],'Greece':['Super League'],'Mexico':['Liga MX']}
sources=list(entries)
for r in json.loads((root/'gsa-logo-references.json').read_text()):
 if r['name'] in extra.get(r['country'],[]):
  key=r['country']+' | '+r['name']; countries[key]=r['country'];sources.append(dict(r,kind='competition',name=key))
seen=set()
for comp in sources:
 country=countries.get(comp['name'])
 continental=comp['name'] in ['Copa Sudamericana 2025','Copa Libertadores 2026','UEFA Conference League - Quali']
 if continental:country='International'
 if not country or comp['kind']!='competition' or 'globalsportsarchive.com' not in comp['sourceUrl']:continue
 url=comp['sourceUrl']
 if url in seen:continue
 seen.add(url)
 cache=root/('gsa-'+hashlib.sha256(url.encode()).hexdigest()+'.html')
 if not cache.exists():
  if country=='Ghana' and (root/'gsa-ghana.html').exists():cache.write_text((root/'gsa-ghana.html').read_text())
  else:
   time.sleep(3)
   try:
    with urllib.request.urlopen(url,timeout=25) as r:body=r.read().decode()
   except Exception as e:
    print('UNRESOLVED',url,str(e),flush=True)
    if getattr(e,'code',None) in (403,429,503):break
    continue
   if re.search('Just a moment|One moment, please',body,re.I):raise RuntimeError('Source access challenge; stopping')
   cache.write_text(body)
 p=Images();p.feed(cache.read_text()); candidates={}
 for name,ident in p.rows:
  if ident in p.large:candidates.setdefault(norm(name),set()).add((ident,p.large[ident]))
 for t in audit['teams']:
  if t['state'] in ('valid','blocked') or (comp.get('entityId') not in t.get('competitionIds',[]) if continental else country not in t['countries']):continue
  matches=candidates.get(norm(t['name']),set())
  if len(matches)!=1:continue
  ident,image=next(iter(matches))
  for entity in t['providerIds']:
   if any(e['entityId']==entity for e in entries):continue
   c={'kind':'team','entityId':entity,'name':t['name'],'url':image,'sourceUrl':url,'identityEvidence':f'Exact normalized club name in reviewed {country} competition standings; existing fixture competition membership checked for continental teams; GSA club ID {ident}. Image URL observed on the same page.','attribution':'Global Sports Archive logo reference; mark belongs to its owner'}
   entries.append(c);report.append(c)
 reviewed.write_text(json.dumps(entries,indent=2,ensure_ascii=False)+'\n')
 (root/'gsa-team-candidates.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
 print(country,len(p.rows),'table images',flush=True)
reviewed.write_text(json.dumps(entries,indent=2,ensure_ascii=False)+'\n');(root/'gsa-team-candidates.json').write_text(json.dumps(report,indent=2,ensure_ascii=False));print('Prepared',len(report),'exact team candidates')
