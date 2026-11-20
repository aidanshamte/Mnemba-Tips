import{test}from'node:test';import assert from'node:assert/strict';import{tableLogoCandidates,uniqueLogoMatch}from'../../lib/football/logo-discovery.mjs';
test('only table logo references are candidates; ambiguous names never resolve',()=>{const html='<img src="https://cdnbfc.com/outside.webp" alt="Simba logo"><table><tr><td><img src="https://cdnbfc.com/a.webp" alt="Simba logo"></td><td><img src="https://tracker.example/pixel.png" alt="Simba logo"></td></tr></table>';const c=tableLogoCandidates(html);assert.equal(c.length,1);assert.equal(uniqueLogoMatch('Simba SC',c).url,'https://cdnbfc.com/a.webp');assert.equal(uniqueLogoMatch('Simba SC',[...c,{name:'Simba',url:'https://cdnbfc.com/b.webp'}]),null);assert.equal(uniqueLogoMatch('Simba Queens',c),null);});
test('reads profile country and only trusts recorded OpenFootball file geography',async()=>{const{profileCountry,visualCompetitionContext}=await import('../../lib/football/logo-discovery.mjs');assert.equal(profileCountry('<h2>Team Info</h2><div><p>Season</p><p>Country</p></div><div class="column has-text-right"><p>2026/27</p><p>Tanzania</p></div><h2>Competition</h2>'),'Tanzania');assert.equal(visualCompetitionContext({name:'League'},'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/tr.1.json').country.name,'Turkey');assert.equal(visualCompetitionContext({name:'League'},'https://untrusted.example/tr.1.json').country,undefined);});

test('fixture status annotations are not club identity, while reserve and gender markers remain',async()=>{const{logoName}=await import('../../lib/football/logo-discovery.mjs');assert.equal(logoName('Kaizer Chiefs     [cancelled]'),logoName('Kaizer Chiefs'));assert.equal(logoName('CR Bélouizdad [postponed]'),logoName('CR Bélouizdad'));assert.notEqual(logoName('Bayern München II'),logoName('Bayern München'));assert.notEqual(logoName('Arsenal Women'),logoName('Arsenal'));});

test('provider crest candidates require explicit image references and retain exact identity context',async()=>{
 const {liveScoreLogoCandidate}=await import('../../lib/football/logo-discovery.mjs');
 const team={ID:'123',Nm:'Arsenal Women',Img:'teambadge/arsenal-2024.png',Spid:1,Gd:2,CoNm:'England'};
 const c=liveScoreLogoCandidate(team,'456');assert.equal(c.sourceEntityId,'livescore:123');assert.equal(c.gender,2);assert.equal(c.entityName,'Arsenal Women');assert.match(c.url,/arsenal-2024.png$/);
 for(const change of [{Img:null},{Img:'../other.png'},{Img:'https://evil.example/x.png'},{Spid:2}])assert.equal(liveScoreLogoCandidate({...team,...change},'456'),null);
});

test('cross-provider visual reuse requires country, team category and unambiguous artwork',async()=>{
 const {verifiedLogoMatch}=await import('../../lib/football/logo-discovery.mjs');const target={name:'Barcelona',countries:['Spain'],category:'senior-men'},source={...target,media:{contentHash:'a'}};
 assert.equal(verifiedLogoMatch(target,[source]),source);
 for(const patch of [{countries:['Ecuador']},{category:'senior-women'},{category:'u21-men'},{name:'Barcelona II'}])assert.equal(verifiedLogoMatch(target,[{...source,...patch}]),null);
 assert.equal(verifiedLogoMatch(target,[source,{...source,media:{contentHash:'b'}}]),null);
});
