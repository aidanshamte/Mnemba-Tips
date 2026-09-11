const urls=[
 ['repos','https://api.github.com/orgs/openfootball/repos?per_page=100'],
 ['sports','https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d='+new Date().toISOString().slice(0,10)+'&s=Soccer'],
 ['leagues','https://www.thesportsdb.com/api/v1/json/123/all_leagues.php'],
 ['cup','https://api.github.com/repos/openfootball/champions-league/git/trees/master?recursive=1'],
];
for(const [name,url] of urls){try{const r=await fetch(url,{headers:{'User-Agent':'PitchPredict-local/4.0'},signal:AbortSignal.timeout(20000)});const d=await r.json();console.log(name,r.status,JSON.stringify(name==='repos'?d.map(x=>({name:x.name,branch:x.default_branch,license:x.license?.spdx_id})):name==='cup'?d.tree?.filter(x=>/2025-26/.test(x.path)).map(x=>x.path):name==='leagues'?d.leagues?.filter(x=>x.strSport==='Soccer').slice(0,3):d.events?.slice(0,1)));}catch(e){console.log(name,e.message);}}
