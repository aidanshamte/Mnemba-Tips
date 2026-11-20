import {worldwideFile} from './worldwide-targets.mjs';
// Explicit source paths classify imported records; this is not a menu of coverage.
// Names are stable competition labels, not claims about current sponsorship or rules.
export const FIRST_BATCH = [
 {id:'egypt',name:'Egyptian Premier League',country:'Egypt',region:'Africa',code:'eg',path:/^africa\/egypt\/.*_eg1\.txt$/},
 {id:'morocco',name:'Botola Pro',country:'Morocco',region:'Africa',code:'ma',path:/^africa\/morocco\/.*_ma1\.txt$/},
 {id:'south-africa',name:'South African Premier Division',country:'South Africa',region:'Africa',code:'za',path:/^africa\/south-africa\/.*_za1\.txt$/},
 {id:'algeria',name:'Algerian Ligue 1',country:'Algeria',region:'Africa',code:'dz',path:/^africa\/algeria\/.*_dz1\.txt$/},
 {id:'tunisia',name:'Tunisian Ligue Professionnelle 1',country:'Tunisia',region:'Africa',code:'tn',path:/^africa\/tunisia\/.*_tn1\.txt$/},
 {id:'brasileirao',name:'Campeonato Brasileiro Série A',country:'Brazil',region:'South America',code:'br',fileCode:'br.1'},
 {id:'argentina',name:'Argentine Primera División',country:'Argentina',region:'South America',code:'ar',path:/^argentina\/20\d{2}(?:-\d{2})?_ar1\.txt$/},
 {id:'liga-mx',name:'Liga MX',country:'Mexico',region:'North America',code:'mx',path:/^north-america\/mexico\/.*_mx1\.txt$/},
 {id:'mls',name:'Major League Soccer',country:'United States',region:'North America',code:'us',path:/^north-america\/major-league-soccer\/.*_mls\.txt$/},
 {id:'saudi',name:'Saudi Pro League',country:'Saudi Arabia',region:'Asia',code:'sa',path:/^middle-east\/saudi-arabia\/.*_sa1\.txt$/},
 {id:'j1',name:'J1 League',country:'Japan',region:'Asia',code:'jp',fileCode:'jp.1',path:/^asia\/japan\/.*_jp1\.txt$/},
];
export function batchCompetition(entry){return FIRST_BATCH.find(c=>(entry.repository==='world'&&c.path?.test(entry.path))||(entry.repository==='football.json'&&c.fileCode&&entry.path.endsWith('/'+c.fileCode+'.json'))||(entry.repository==='south-america'&&c.id==='argentina'&&c.path.test(entry.path)))??null;}
export function sourceGeography(entry){
 const c=batchCompetition(entry)??worldwideFile(entry);if(!c)return null;
 return {id:`openfootball:country:${c.code??c.country.toLowerCase().replaceAll(" ","-")}`,provider:'openfootball',externalId:c.code??c.country,name:c.country,code:null,continent:c.region,confederation:({Africa:'CAF',Asia:'AFC','North America':'CONCACAF','South America':'CONMEBOL',Europe:'UEFA',Oceania:'AFC'})[c.region],sourceUrl:entry.url};
}
