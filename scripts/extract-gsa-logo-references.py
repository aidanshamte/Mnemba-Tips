"""Extract logo references from an already downloaded public source page; no data fetching."""
from html.parser import HTMLParser
from pathlib import Path
import json
class References(HTMLParser):
    def __init__(self):
        super().__init__(); self.country=None; self.links=[]; self.rows=[]; self.pending=None
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='a':
            href=a.get('href','')
            if self.pending and '/soccer/competition/' in href:
                self.rows.append(dict(**self.pending,sourceUrl=href)); self.pending=None
        if tag!='img': return
        alt=a.get('alt',''); url=a.get('src','')
        if alt.startswith('flag of '): self.country=alt[8:]
        if '/comps/50x50/' in url:
            self.pending=dict(country=self.country,name=alt,url=url)
    def handle_endtag(self,tag):
        if tag=='a' and self.links:self.links.pop()
p=References(); p.feed(Path('.sites-runtime/real-logos/tra-gsa.html').read_text())
Path('.sites-runtime/real-logos/gsa-logo-references.json').write_text(json.dumps(p.rows,indent=2))
for r in p.rows:
    if r['country'] in ['Ghana','Nigeria','Rwanda','Zambia','Uganda','Turkey','China','Belgium','Spain'] or any(x in r['name'] for x in ['World Cup','European','Sudamericana','Libertadores','Conference']): print(r)
