// Display grouping only: preserve every provider ID and all underlying records.
// Conservative explicit aliases avoid merging unrelated divisions or women's leagues.
const groups=[
 ['Africa Cup of Nations',['african cup of nations','african cup of nations 2026','africa cup of nations']],
 ['La Liga',['primera division','primera división','spanish la liga','spain primera división','la liga']],
 ['Premier League',['english premier league','premier league']],
 ['Bundesliga',['deutsche bundesliga','german bundesliga','1. fußball-bundesliga','bundesliga']],
 ['Serie A',['italian serie a','italy serie a','serie a']],
 ['Ligue 1',['french ligue 1','france ligue 1','ligue 1']],
 ['UEFA Champions League',['uefa champions league','uefa champions league - quali']],
 ['UEFA Europa League',['uefa europa league','uefa europa league - quali']],
 ['UEFA Conference League',['uefa conference league','uefa conference league - quali']],
];
export function competitionLabel(c){return groups.find(([,names])=>names.includes(c.name.toLowerCase().trim()))?.[0]??c.name;}
export function groupCompetitions(competitions){
 const grouped=new Map();
 for(const c of competitions){const name=competitionLabel(c),key=name===c.name&&!groups.some(([n])=>n===name)?c.id:name;
  if(!grouped.has(key))grouped.set(key,{...c,name,providerIds:[],seasons:[],fixtureCount:0});
  const group=grouped.get(key);group.providerIds.push(c.id);group.seasons.push(...(c.seasons??[]));group.fixtureCount+=c.fixtureCount??0;
 }
 return [...grouped.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
