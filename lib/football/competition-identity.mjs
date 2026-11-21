// Canonical football identity: Continent → country or governing body → competition → season → stage → group.
// Pure functions only. A provider record is mapped to a canonical competition by:
//   1. its scope (country, or governing body for international competitions; never inferred from a bare name),
//   2. a curated alias registry within that scope, or its own normalized name,
//   3. gender and age category (women's, youth and senior competitions never share an identity),
// and cross-provider merges are only accepted with team-overlap evidence (see planCompetitionIdentities).
// Stage, group, round and season text is parsed out of provider names and kept as structure, not as leagues.

export function norm(value) {
  return String(value ?? '').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export const slug = value => norm(value).replace(/'/g, '').replace(/ /g, '-');

const COUNTRY_ALIASES = {turkiye: 'Turkey', usa: 'United States', 'united states of america': 'United States', 'republic of korea': 'South Korea', 'korea republic': 'South Korea', 'czechia': 'Czech Republic'};
export const canonicalCountry = name => { const n = norm(name); return COUNTRY_ALIASES[n] ?? (name ? String(name).trim() : null); };

// Demonyms and country names that may prefix (or suffix) a provider's competition name. Used only to strip the
// country from the name and, for records without any country, to read the country the provider itself named.
const DEMONYMS = {
  algerian: 'Algeria', american: 'United States', argentine: 'Argentina', argentinian: 'Argentina', argentina: 'Argentina', austrian: 'Austria', belgian: 'Belgium', belgium: 'Belgium',
  brazilian: 'Brazil', brasileiro: 'Brazil', brasileirao: 'Brazil', chile: 'Chile', chilean: 'Chile', china: 'China', chinese: 'China', colombia: 'Colombia', colombian: 'Colombia', denmark: 'Denmark', danish: 'Denmark',
  dutch: 'Netherlands', netherlands: 'Netherlands', egyptian: 'Egypt', english: 'England', estonian: 'Estonia', french: 'France', georgian: 'Georgia', german: 'Germany', deutsche: 'Germany',
  ghana: 'Ghana', greece: 'Greece', greek: 'Greece', irish: 'Ireland', israeli: 'Israel', italian: 'Italy', japanese: 'Japan', kazakhstan: 'Kazakhstan', kenyan: 'Kenya', latvian: 'Latvia',
  nigeria: 'Nigeria', nigerian: 'Nigeria', norwegian: 'Norway', peruvian: 'Peru', polish: 'Poland', portuguese: 'Portugal', russia: 'Russia', russian: 'Russia', rwanda: 'Rwanda',
  'saudi arabia': 'Saudi Arabia', saudi: 'Saudi Arabia', scottish: 'Scotland', 'south african': 'South Africa', spain: 'Spain', spanish: 'Spain', swedish: 'Sweden', sweden: 'Sweden',
  tanzania: 'Tanzania', turkish: 'Turkey', uganda: 'Uganda', uzbekistan: 'Uzbekistan', zambia: 'Zambia',
};
const CONTINENTS = {
  Africa: ['Algeria', 'Egypt', 'Ghana', 'Kenya', 'Morocco', 'Nigeria', 'Rwanda', 'South Africa', 'Tanzania', 'Tunisia', 'Uganda', 'Zambia'],
  Asia: ['China', 'Hong Kong', 'India', 'Indonesia', 'Iran', 'Iraq', 'Japan', 'Kuwait', 'Malaysia', 'Qatar', 'Saudi Arabia', 'Singapore', 'South Korea', 'Thailand', 'United Arab Emirates', 'Uzbekistan', 'Vietnam', 'Kazakhstan'],
  Europe: ['Albania', 'Armenia', 'Austria', 'Azerbaijan', 'Belarus', 'Belgium', 'Bosnia and Herzegovina', 'Bulgaria', 'Croatia', 'Cyprus', 'Czech Republic', 'Denmark', 'England', 'Estonia', 'Faroe Islands', 'Finland', 'France', 'Georgia', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland', 'Israel', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Moldova', 'Montenegro', 'Netherlands', 'North Macedonia', 'Northern Ireland', 'Norway', 'Poland', 'Portugal', 'Romania', 'Russia', 'Scotland', 'Serbia', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'Turkey', 'Ukraine', 'Wales'],
  'North America': ['Canada', 'Costa Rica', 'El Salvador', 'Guatemala', 'Honduras', 'Mexico', 'United States'],
  'South America': ['Argentina', 'Bolivia', 'Brazil', 'Chile', 'Colombia', 'Ecuador', 'Paraguay', 'Peru', 'Uruguay', 'Venezuela'],
  Oceania: ['Australia', 'New Zealand'],
};
export const continentOf = country => Object.entries(CONTINENTS).find(([, list]) => list.includes(country))?.[0] ?? null;

// International competitions: governed by a confederation or FIFA, matched by explicit alias only.
// regionalStages: a trailing North/South/East/West segment is a stage of this competition, not a separate one.
const INTERNATIONAL = [
  ['UEFA Champions League', 'UEFA', 'Europe', ['uefa champions league'], {}],
  ['UEFA Europa League', 'UEFA', 'Europe', ['uefa europa league'], {}],
  ['UEFA Conference League', 'UEFA', 'Europe', ['uefa conference league', 'uefa europa conference league'], {}],
  ['UEFA Nations League', 'UEFA', 'Europe', ['uefa nations league'], {}],
  ['UEFA European Championship', 'UEFA', 'Europe', ['euro', 'uefa euro', 'uefa european championship'], {}],
  ['UEFA European Under-21 Championship', 'UEFA', 'Europe', ['uefa european under 21 championship', 'euro u21'], {age: 'U21'}],
  ["UEFA Women's Championship", 'UEFA', 'Europe', ["uefa women's euro", "uefa women's championship"], {gender: 'women'}],
  ["UEFA Women's Champions League", 'UEFA', 'Europe', ["uefa women's champions league"], {gender: 'women'}],
  ['UEFA Youth League', 'UEFA', 'Europe', ['uefa youth league'], {age: 'U19'}],
  ['FIFA World Cup', 'FIFA', 'World', ['world cup', 'fifa world cup'], {}],
  ["FIFA Women's World Cup Qualification", 'FIFA', 'World', ["women's world cup qualification"], {gender: 'women'}],
  ['FIFA U-17 World Cup', 'FIFA', 'World', ['world cup u17', 'fifa u 17 world cup'], {age: 'U17'}],
  ['Africa Cup of Nations', 'CAF', 'Africa', ['africa cup of nations', 'african cup of nations'], {}],
  ['Africa Cup of Nations Qualification', 'CAF', 'Africa', ['africa cup of nations qualification', 'african cup of nations qualification', 'african cup of nations qualifying'], {}],
  ['CAF Champions League', 'CAF', 'Africa', ['caf champions league'], {}],
  ['CAF Super Cup', 'CAF', 'Africa', ['caf super cup'], {}],
  ['AFC Champions League Elite', 'AFC', 'Asia', ['afc champions league elite'], {regionalStages: true}],
  ['AFC Champions League Two', 'AFC', 'Asia', ['afc champions league two'], {}],
  ['AFC Challenger League', 'AFC', 'Asia', ['afc challenger league'], {}],
  ['SAFF Championship', 'SAFF', 'Asia', ['saff championship'], {}],
  ['Arabian Gulf Cup', 'AGCFF', 'Asia', ['gulf cup', 'arabian gulf cup'], {}],
  ['Asian Games', 'OCA', 'Asia', ['asian games'], {age: 'U23'}],
  ['Copa Libertadores', 'CONMEBOL', 'South America', ['copa libertadores', 'conmebol libertadores'], {}],
  ['Copa Sudamericana', 'CONMEBOL', 'South America', ['copa sudamericana', 'conmebol sudamericana'], {}],
  ['CONCACAF Nations League', 'CONCACAF', 'North America', ['concacaf nations league'], {}],
  ['CONCACAF Central American Cup', 'CONCACAF', 'North America', ['concacaf central american cup', 'central american cup'], {}],
  ['Club Friendlies', 'FIFA', 'World', ['club friendlies'], {type: 'friendly'}],
  ['International Friendlies', 'FIFA', 'World', ['friendlies', 'international friendlies'], {type: 'friendly'}],
  ['International Friendlies U21', 'FIFA', 'World', ['friendlies u21'], {type: 'friendly', age: 'U21'}],
  ["Women's International Friendlies", 'FIFA', 'World', ["women's friendlies"], {type: 'friendly', gender: 'women'}],
].map(([name, governingBody, continent, aliases, extra]) => ({name, governingBody, continent, aliases, type: 'international', gender: 'men', age: null, ...extra}));

// LiveScore categories whose record names are only stages or groups of the category competition.
const CATEGORY_COMPETITION = {
  'africa cup of nations qualification': 'Africa Cup of Nations Qualification', 'uefa nations league': 'UEFA Nations League', 'concacaf nations league': 'CONCACAF Nations League',
  'champions league': 'UEFA Champions League', 'europa league': 'UEFA Europa League', 'conference league': 'UEFA Conference League',
  'copa libertadores': 'Copa Libertadores', 'copa sudamericana': 'Copa Sudamericana', "uefa women's champions league": "UEFA Women's Champions League",
  'uefa youth league': 'UEFA Youth League', "women's world cup qualification": "FIFA Women's World Cup Qualification", 'world cup u17': 'FIFA U-17 World Cup',
  'euro u21': 'UEFA European Under-21 Championship', 'club friendlies': 'Club Friendlies',
};
// Categories that name a region, not a competition: the first name segment is the competition.
const REGION_CATEGORIES = new Set(['asia', 'international', 'africa', 'europe', 'concacaf', 'south america', 'north central america', 'world', 'international friendlies']);

// Domestic aliases within one country. Each list is one competition; tier where verified.
const DOMESTIC = {
  Algeria: [['Algerian Ligue 1', 1, ['ligue 1', 'algerian ligue 1']]],
  Argentina: [['Liga Profesional', 1, ['liga profesional', 'primera division', 'argentine primera division', 'argentinian primera division']], ['Primera Nacional', 2, ['primera nacional', 'primera b nacional', 'argentinian primera b nacional']], ['Primera B Metropolitana', 3, ['primera b metropolitana', 'argentina primera b metropolitana']]],
  Australia: [['A-League Men', 1, ['a league', 'a league men']], ['A-League Women', 1, ['a league women'], {gender: 'women'}], ['Australian Championship', null, ['australian championship']]],
  Austria: [['Austrian Bundesliga', 1, ['bundesliga', 'austrian bundesliga']], ['2. Liga', 2, ['2 liga']]],
  Belgium: [['Belgian Pro League', 1, ['belgian pro league', 'jupiler pro league', 'belgium first division a', 'first division a', 'pro league']], ['Challenger Pro League', 2, ['challenger pro league']]],
  Brazil: [['Brazilian Série A', 1, ['serie a', 'brasileiro serie a', 'brasileirao serie a', 'brazilian serie a', 'campeonato brasileiro serie a']], ['Brazilian Série B', 2, ['serie b', 'brasileiro serie b', 'brasileirao serie b', 'brazilian serie b']], ['Brazilian Série C', 3, ['serie c']]],
  China: [['Chinese Super League', 1, ['super league', 'china super league', 'chinese super league']], ['China League One', 2, ['league one']], ['Chinese FA Cup', null, ['fa cup']]],
  Colombia: [['Categoría Primera A', 1, ['primera a', 'categoria primera a']], ['Categoría Primera B', 2, ['primera b', 'categoria primera b']]],
  Egypt: [['Egyptian Premier League', 1, ['premier league', 'egyptian premier league']]],
  England: [['Premier League', 1, ['premier league', 'english premier league']], ['EFL Championship', 2, ['championship', 'english championship', 'efl championship']], ['EFL League One', 3, ['league 1', 'league one']], ['EFL League Two', 4, ['league 2', 'league two']],
    ['National League', 5, ['national league']], ['National League North', 6, ['national league north']], ['National League South', 6, ['national league south', 'english national league south']],
    ["Women's Super League", 1, ["fa women's super league", "women's super league", 'wsl'], {gender: 'women'}], ['EFL Trophy', null, ['efl trophy'], {regionalStages: true}]],
  France: [['Ligue 1', 1, ['ligue 1', 'french ligue 1']], ['Ligue 2', 2, ['ligue 2', 'french ligue 2']], ['Ligue 3', 3, ['ligue 3']], ['Première Ligue', 1, ['premiere ligue femenine', 'premiere ligue feminine', 'premiere ligue'], {gender: 'women'}]],
  Germany: [['Bundesliga', 1, ['bundesliga', 'deutsche bundesliga', 'german bundesliga', '1 fussball bundesliga']], ['2. Bundesliga', 2, ['2 bundesliga', '2 fussball bundesliga']], ['3. Liga', 3, ['3 liga']], ['DFB-Pokal', null, ['dfb pokal', 'dfb cup']], ['Frauen-Bundesliga', 1, ['frauen bundesliga'], {gender: 'women'}]],
  Ghana: [['Ghana Premier League', 1, ['premier league', 'ghana premier league']]],
  Greece: [['Super League Greece', 1, ['super league', 'super league greece', 'super league 1']], ['Super League 2', 2, ['super league 2']]],
  Ireland: [['League of Ireland Premier Division', 1, ['league of ireland premier division', 'premier division', 'irish premier division']]],
  Israel: [['Israeli Premier League', 1, ['premier league', 'israeli premier league', 'ligat haal']]],
  Italy: [['Serie A', 1, ['serie a', 'italian serie a']], ['Serie B', 2, ['serie b', 'italian serie b']], ['Serie C', 3, ['serie c']], ["Women's Serie A", 1, ["women's serie a"], {gender: 'women'}]],
  Japan: [['J1 League', 1, ['j1 league', 'j league', 'j1']], ['J2 League', 2, ['j2 league']], ['J3 League', 3, ['j3 league']]],
  Mexico: [['Liga MX', 1, ['liga mx']], ['Liga de Expansión MX', 2, ['liga de expansion mx']], ['Liga MX Femenil', 1, ["women's liga mx", 'liga mx femenil'], {gender: 'women'}]],
  Morocco: [['Botola Pro', 1, ['botola pro']]],
  Netherlands: [['Eredivisie', 1, ['eredivisie', 'netherlands eredivisie', 'dutch eredivisie']], ['Eerste Divisie', 2, ['eerste divisie']]],
  Nigeria: [['Nigeria Premier Football League', 1, ['npfl', 'nigeria premier league', 'nigeria professional football league', 'nigeria premier football league']]],
  Norway: [['Eliteserien', 1, ['eliteserien', 'norwegian eliteserien']]],
  Peru: [['Liga 1', 1, ['liga 1', 'peruvian primera division']]],
  Portugal: [['Primeira Liga', 1, ['primeira liga', 'portuguese primeira liga', 'liga portugal']], ['Liga Portugal 2', 2, ['liga portugal 2']]],
  'Saudi Arabia': [['Saudi Pro League', 1, ['saudi professional league', 'saudi arabia saudi professional league', 'saudi pro league']]],
  Scotland: [['Scottish Premiership', 1, ['premiership', 'scottish premiership']], ['Scottish Championship', 2, ['championship']]],
  'South Africa': [['South African Premiership', 1, ['premiership', 'south african premier division', 'premier division', 'psl']]],
  Spain: [['LaLiga', 1, ['laliga', 'la liga', 'primera division', 'spain primera division', 'spanish la liga']], ['LaLiga 2', 2, ['laliga 2', 'la liga 2', 'segunda division']], ['Liga F', 1, ['liga f'], {gender: 'women'}]],
  Sweden: [['Allsvenskan', 1, ['allsvenskan', 'swedish allsvenskan']], ['Superettan', 2, ['superettan', 'swedish superettan']], ['Damallsvenskan', 1, ["women's allsvenskan", 'damallsvenskan', 'sweden damallsvenskan'], {gender: 'women'}], ['Division 1 South', 3, ['division 1 south', 'swedish division 1 south']], ['Division 1 North', 3, ['division 1 north']]],
  Tanzania: [['NBC Premier League', 1, ['premier league', 'nbc premier league', 'tanzania nbc premier league']]],
  Turkey: [['Süper Lig', 1, ['super lig', 'turkish super lig']]],
  'United States': [['Major League Soccer', 1, ['mls', 'major league soccer', 'american major league soccer']], ['USL Championship', 2, ['usl championship', 'american usl championship']], ['USL League One', 3, ['usl league one', 'american usl league one']], ["National Women's Soccer League", 1, ["national women's soccer league", 'nwsl'], {gender: 'women'}]],
  Uzbekistan: [['Uzbekistan Super League', 1, ['super league', 'uzbekistan super league']]],
  Georgia: [['Erovnuli Liga', 1, ['erovnuli liga', 'georgian erovnuli liga']], ['Erovnuli Liga 2', 2, ['erovnuli liga 2', 'georgian erovnuli liga 2']]],
  Estonia: [['Meistriliiga', 1, ['meistriliiga', 'estonian meistriliiga']], ['Esiliiga', 2, ['esiliiga', 'estonian esiliiga']]],
  Chile: [['Chilean Primera División', 1, ['primera division', 'chile primera division']]],
  Kazakhstan: [['Kazakhstan Premier League', 1, ['premier league']], ['Kazakhstan First League', 2, ['first league', 'kazakhstan first league']]],
};

const GROUP_RE = /^(?:group|grupo|gruppe|pool)\s+[a-z0-9]+$/i;
const DIRECTION_RE = /^(north|south|east|west|central)$/i;
const SEASON_RE = /\b((?:19|20)\d{2})(?:\s*[/-]\s*((?:19|20)?\d{2}))?\b/;

export function genderOf(name, declared) {
  const n = norm(name);
  if (/\bwomen|\bfemen|\bfeminin|\bfrauen|\bdamallsvenskan\b|\bliga f\b|\bnwsl\b|\bwsl\b|\btoppserien\b/.test(n) || /^female|^women/i.test(declared ?? '')) return 'women';
  return 'men';
}
export function ageOf(name) {
  const n = norm(name), u = n.match(/\bu ?(\d{2})\b/);
  if (u) return `U${u[1]}`;
  if (/\byouth\b|\bjunior\b/.test(n)) return 'youth';
  if (/^premier league 2$/.test(n)) return 'U21';
  return null;
}

/** Split a provider name into base competition name, stage, group and season label. */
export function parseCompetitionName(raw, country) {
  let text = String(raw ?? '').trim(), season = null;
  const aliasHints = [];
  text = text.replace(/\(([^)]*)\)/g, (_, inner) => { aliasHints.push(inner.trim()); return ' '; });
  // "China | Super League 2025": a leading country before a pipe is scope, not name.
  if (text.includes('|')) { const [left, ...right] = text.split('|'); if (country && norm(left) === norm(country)) text = right.join('|'); }
  text = text.replace(/\s+-\s+quali(?:fication|fying)?$/i, ': Qualification');
  const segments = text.split(/\s*:\s*/).map(s => s.trim()).filter(Boolean);
  const take = s => { const m = s.match(SEASON_RE); if (m) { season ??= m[2] ? `${m[1]}/${m[2].slice(-2)}` : m[1]; return s.replace(SEASON_RE, ' ').replace(/\s+/g, ' ').trim(); } return s; };
  const cleaned = segments.map(take).filter(Boolean);
  let base = cleaned.shift() ?? String(raw ?? '');
  const stages = [], groups = [];
  for (const s of cleaned) (GROUP_RE.test(s) ? groups : stages).push(s);
  return {base, stages, group: groups.at(-1) ?? null, season, aliasHints};
}

function stripCountry(base, country) {
  let n = norm(base);
  const names = [norm(country), ...Object.entries(DEMONYMS).filter(([, c]) => c === country).map(([d]) => d)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const p of names) { if (n.startsWith(p + ' ') && n.length > p.length + 3) { n = n.slice(p.length + 1); break; } if (n.endsWith(' ' + p) && n.length > p.length + 3) { n = n.slice(0, -p.length - 1); break; } }
  return n;
}
function countryFromName(base) {
  const n = norm(base);
  return Object.entries(DEMONYMS).sort((a, b) => b[0].length - a[0].length).find(([d]) => n.startsWith(d + ' '))?.[1] ?? null;
}
// Domestic aliases that belong to exactly one country identify that country (e.g. "major league soccer").
const UNIQUE_ALIAS = (() => { const seen = new Map(); for (const [country, list] of Object.entries(DOMESTIC)) for (const [, , aliases] of list) for (const a of aliases) seen.set(a, seen.has(a) && seen.get(a) !== country ? null : country); return seen; })();
const GENERIC = new Set(['cup', 'league', 'premier league', 'super league', 'super cup', 'first division', 'primera division', 'serie a', 'serie b', 'ligue 1', 'ligue 2', 'bundesliga', 'championship', 'premiership', 'league one', 'league 1', 'league 2', 'liga 1', 'premier division']);
const findInternational = n => INTERNATIONAL.find(e => e.aliases.includes(n) || norm(e.name) === n);
const domesticEntry = (country, n) => (DOMESTIC[country] ?? []).find(([, , aliases]) => aliases.includes(n));

/**
 * Resolve one provider competition record.
 * record: {id, provider, name, country: {name, continent} | null, type, gender}
 */
export function resolveCompetition(record) {
  const rawCountry = record.country?.name ?? null, category = norm(rawCountry);
  const declaredGender = record.gender ?? null;
  let keyName = null, scope, scopeKind, governingBody = null, country = null, continent = null, name, tier = null, type = record.type ?? null, basis, inferred = false, regionalStages = false, entryExtra = {};
  let parsed;
  if (record.provider === 'livescore' && CATEGORY_COMPETITION[category.replace(/ \d{4}$/, '')]) {
    // Category is the competition (e.g. "Africa Cup of Nations Qualification" → "Qualification: Group F").
    const compName = CATEGORY_COMPETITION[category.replace(/ \d{4}$/, '')], entry = findInternational(norm(compName));
    const seasonMatch = String(rawCountry).match(SEASON_RE);
    const all = parseCompetitionName(record.name, null), stages = [all.base, ...all.stages].filter(s => !GROUP_RE.test(s));
    parsed = {base: compName, stages: stages.filter(s => !norm(compName).includes(norm(s))), group: GROUP_RE.test(all.base) ? all.base : all.group, season: all.season ?? (seasonMatch ? seasonMatch[1] : null), aliasHints: []};
    ({governingBody, continent} = entry); name = entry.name; type = entry.type; scope = governingBody; scopeKind = 'governing-body'; basis = 'provider-category'; entryExtra = entry;
  } else {
    const isRegion = !rawCountry || REGION_CATEGORIES.has(category);
    parsed = parseCompetitionName(record.name, isRegion ? null : canonicalCountry(rawCountry));
    const n = norm(parsed.base), intl = findInternational(n) ?? findInternational(n.replace(/ (north|south|east|west|central)$/, ''));
    if (intl) {
      ({governingBody, continent} = intl); name = intl.name; type = intl.type; scope = governingBody; scopeKind = 'governing-body'; basis = 'registry'; entryExtra = intl; regionalStages = !!intl.regionalStages;
      const dir = n.match(/ (north|south|east|west|central)$/); if (dir && regionalStages && !findInternational(n)) parsed.stages.unshift(dir[1][0].toUpperCase() + dir[1].slice(1));
    } else if (!isRegion) {
      country = canonicalCountry(rawCountry); scope = country; scopeKind = 'country'; continent = record.country?.continent ?? continentOf(country);
    } else if (!rawCountry && (countryFromName(parsed.base) || (!GENERIC.has(n) && UNIQUE_ALIAS.get(n)))) {
      country = countryFromName(parsed.base) ?? UNIQUE_ALIAS.get(n); scope = country; scopeKind = 'country'; continent = continentOf(country); inferred = true;
    } else {
      scope = rawCountry ? `region:${rawCountry}` : `unscoped:${record.id}`; scopeKind = rawCountry ? 'region' : 'unscoped';
      continent = rawCountry && !REGION_CATEGORIES.has(category) ? null : (['asia', 'africa', 'europe'].includes(category) ? rawCountry : null);
    }
    if (scopeKind === 'country') {
      // A trailing direction is a separate division ("National League: North") unless the competition stages regions.
      if (DIRECTION_RE.test(parsed.stages[0] ?? '')) {
        const merged = `${parsed.base} ${parsed.stages[0]}`, mergedEntry = domesticEntry(country, stripCountry(merged, country)), baseEntry = domesticEntry(country, stripCountry(parsed.base, country));
        if (mergedEntry || !baseEntry?.[3]?.regionalStages) { parsed.base = merged; parsed.stages.shift(); }
      }
      let local = stripCountry(parsed.base, country);
      const dirMatch = local.match(/^(.*) (north|south|east|west|central)$/);
      if (dirMatch && !domesticEntry(country, local) && domesticEntry(country, dirMatch[1])?.[3]?.regionalStages) { local = dirMatch[1]; parsed.stages.unshift(dirMatch[2][0].toUpperCase() + dirMatch[2].slice(1)); }
      const entry = domesticEntry(country, local);
      if (entry) { name = entry[0]; tier = entry[1]; entryExtra = entry[3] ?? {}; basis = inferred ? 'registry-named-country' : 'registry'; }
      // Unregistered: group by the country-stripped name, display the provider's descriptive name.
      // Generic provider names ("Cup", "Premier League") are shown with their country to stay unambiguous.
      else { name = parsed.base.replace(/\s+/g, ' ').trim(); if (GENERIC.has(norm(name))) name = `${country} ${name}`; keyName = local; basis = inferred ? 'named-country' : 'provider-name'; }
    } else if (!name) { name = parsed.base; basis = basis ?? (scopeKind === 'unscoped' ? 'unscoped' : 'region-prefix'); }
  }
  const gender = entryExtra.gender ?? genderOf(record.name + ' ' + (rawCountry ?? ''), declaredGender);
  const age = entryExtra.age ?? ageOf(record.name) ?? ageOf(rawCountry ?? '');
  type = type ?? (/\bcup\b|pokal|beker|copa|trophy|shield|super cup|supercopa/i.test(name) ? 'cup' : 'league');
  const canonicalId = ['competition', slug(scope), slug(keyName ?? name), gender === 'women' ? 'women' : null, age ? slug(age) : null].filter(Boolean).join(':');
  return {canonicalId, name, scope, scopeKind, country, governingBody, continent, type, tier, gender, age,
    season: parsed.season, stage: parsed.stages.join(' – ') || null, group: parsed.group, basis, inferredCountry: inferred, aliasHints: parsed.aliasHints};
}

// Team names: compare without legal-form tokens and accents. Used for overlap evidence and conservative links only.
const TEAM_STOP = new Set(['fc', 'cf', 'sc', 'afc', 'cd', 'ca', 'club', 'de', 'sv', 'fk', 'sk', 'nk', 'if', 'bk', 'the', 'f', 'c', 'football', 'futbol', 'clube', 'calcio', 'ssc', 'us', 'as', 'ac']);
const TEAM_GENERIC = new Set(['united', 'city', 'real', 'sporting', 'atletico', 'athletic', 'racing', 'olympique', 'deportivo', 'internacional', 'saint', 'santa', 'san', 'sao', 'nova', 'new', 'royal', 'union', 'dynamo', 'dinamo', 'young', 'boys', 'stars', 'rovers', 'town', 'county', 'women', 'paris', 'inter', 'national']);
/** Same team under a provider variant: equal, or every token of the shorter name inside the longer one with a
 *  distinctive token ("goias" ⊂ "goias go", "strasbourg" ⊂ "rc strasbourg alsace"). Used for overlap evidence only. */
export function teamsMatch(a, b) {
  if (a === b) return true;
  const ta = a.split(' '), tb = b.split(' '), [small, big] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  return small.every(t => big.has(t)) && small.some(t => t.length >= 4 && !TEAM_GENERIC.has(t) && !/^\d+$/.test(t));
}
export function normTeam(name) { return norm(name).split(' ').filter(t => !TEAM_STOP.has(t)).join(' ') || norm(name); }

/**
 * Plan canonical competitions from provider records and fixture evidence.
 * competitions: [{id, provider, name, country, type, gender}], fixtures: [{competitionId, startsAt, home, away}] (team names)
 * Returns canonical groups, accepted memberships with evidence, review items and per-group distinct counts.
 */
export function planCompetitionIdentities(allCompetitions, fixtures, {minShared = 3, minRatio = 0.3, minMatches = 5, minMatchRatio = 0.6} = {}) {
  // Records without any fixture are not planned: nothing public depends on them and there is no evidence.
  const active = new Set(fixtures.map(f => f.competitionId)), competitions = allCompetitions.filter(c => active.has(c.id));
  const teamsBy = new Map(), fixturesBy = new Map();
  for (const f of fixtures) {
    if (!teamsBy.has(f.competitionId)) { teamsBy.set(f.competitionId, new Set()); fixturesBy.set(f.competitionId, []); }
    const h = normTeam(f.home), a = normTeam(f.away); teamsBy.get(f.competitionId).add(h).add(a); fixturesBy.get(f.competitionId).push({day: Math.floor(f.startsAt / 86400000), h, a, startsAt: f.startsAt});
  }
  const resolved = competitions.map(c => ({record: c, identity: resolveCompetition(c), fixtures: fixturesBy.get(c.id)?.length ?? 0}));
  const byKey = new Map();
  for (const r of resolved) { if (!byKey.has(r.identity.canonicalId)) byKey.set(r.identity.canonicalId, []); byKey.get(r.identity.canonicalId).push(r); }
  const groups = [], reviews = [], memberships = [];
  for (const [key, members] of byKey) {
    members.sort((a, b) => b.fixtures - a.fixtures || a.record.id.localeCompare(b.record.id));
    const accepted = [], acceptedTeams = new Set(), acceptedProviders = new Set();
    const split = [];
    for (const m of members) {
      const teams = teamsBy.get(m.record.id) ?? new Set();
      let evidence;
      if (!accepted.length) evidence = {basis: 'anchor'};
      else if (acceptedProviders.has(m.record.provider)) evidence = {basis: 'same-provider-structure', note: 'stage, group or season record of the same provider competition'};
      else if (m.identity.scopeKind === 'governing-body') evidence = {basis: m.identity.basis === 'provider-category' ? 'provider-category' : 'governing-body-registry', governingBody: m.identity.governingBody, note: 'unique competition of this governing body; club participants change by season'};
      else {
        const accepted$ = [...acceptedTeams], shared = [...teams].filter(t => accepted$.some(u => teamsMatch(t, u))).length, ratio = teams.size ? shared / Math.min(teams.size, acceptedTeams.size || teams.size) : 0;
        evidence = {basis: 'team-overlap', shared, ratio: Math.round(ratio * 100) / 100, teams: teams.size};
        if (!(shared >= minShared && ratio >= minRatio) && !(teams.size <= 6 && shared >= 2 && ratio >= 0.5)) {
          split.push(m); reviews.push({kind: 'competition-merge', canonicalId: key, providerId: m.record.id, name: m.record.name, reason: teams.size ? 'insufficient team overlap with the canonical competition' : 'no fixtures to compare', evidence}); continue;
        }
      }
      accepted.push(m); for (const t of teams) acceptedTeams.add(t); acceptedProviders.add(m.record.provider);
      memberships.push({providerId: m.record.id, canonicalId: key, evidence, stage: m.identity.stage, group: m.identity.group, season: m.identity.season});
    }
    if (accepted[0].identity.scopeKind === 'unscoped' || accepted[0].identity.scopeKind === 'region') reviews.push({kind: 'competition-scope', canonicalId: key, providerId: accepted[0].record.id, name: accepted[0].record.name, reason: 'no country or governing body could be established', evidence: {scope: accepted[0].identity.scope}});
    groups.push(summarize(key, accepted, fixturesBy));
    // Rejected members keep their own identity (never silently merged).
    for (const m of split) {
      const own = `${key}:${slug(m.record.provider)}-${slug(m.record.externalId ?? m.record.id)}`;
      memberships.push({providerId: m.record.id, canonicalId: own, evidence: {basis: 'kept-separate', reason: 'awaiting review'}, stage: m.identity.stage, group: m.identity.group, season: m.identity.season});
      groups.push(summarize(own, [m], fixturesBy));
    }
  }
  mergeBySharedMatches(groups, memberships, reviews, resolved, fixturesBy, {minMatches, minMatchRatio});
  return {groups: groups.sort((a, b) => a.name.localeCompare(b.name) || (a.country ?? '').localeCompare(b.country ?? '')), memberships, reviews,
    stats: {providerCompetitions: allCompetitions.length, activeProviderCompetitions: competitions.length, canonicalCompetitions: groups.length, merged: memberships.filter(m => m.evidence.basis !== 'anchor' && m.evidence.basis !== 'kept-separate').length, review: reviews.length}};
}

/**
 * Name-independent merge on the strongest evidence: the same matches. Providers name competitions differently
 * ("Germany Bundesliga I" vs "Bundesliga"), so their records can resolve to different keys. Two canonical groups in the
 * same country (or governing body) with the same gender and age group, from different providers, merge only when they
 * record the same matches: at least `minMatches` shared (both teams match, kickoff within a day) and at least
 * `minMatchRatio` of the smaller group's matches in the overlapping period, with a unique best candidate (at least
 * twice the runner-up). Tiers never share matches and a cup tie is filed under the cup, so neither merges. Weaker
 * evidence keeps the groups separate and queues a review.
 */
function mergeBySharedMatches(groups, memberships, reviews, resolved, fixturesBy, {minMatches, minMatchRatio}) {
  const recordOf = new Map(resolved.map(r => [r.record.id, r]));
  const scope = g => g.country ? `c:${g.country}` : g.governingBody ? `b:${g.governingBody}` : null;
  const matchesOf = g => g.providerIds.flatMap(id => fixturesBy.get(id) ?? []);
  const live = new Set(groups.map(g => g.canonicalId));
  // Smaller groups (fewer providers, then fewer matches) are folded into larger ones.
  const order = [...groups].sort((a, b) => a.providers.length - b.providers.length || a.providerRows - b.providerRows);
  for (const source of order) {
    if (!live.has(source.canonicalId) || !scope(source)) continue;
    const mine = matchesOf(source); if (mine.length < minMatches) continue;
    const span = [Math.min(...mine.map(m => m.day)), Math.max(...mine.map(m => m.day))];
    const scored = [];
    for (const target of groups) {
      if (target === source || !live.has(target.canonicalId) || scope(target) !== scope(source) || target.gender !== source.gender || target.age !== source.age) continue;
      if (target.providers.some(p => source.providers.includes(p))) continue;
      const theirs = matchesOf(target).filter(m => m.day >= span[0] - 1 && m.day <= span[1] + 1);
      if (theirs.length < minMatches) continue;
      const byDay = new Map(); for (const m of theirs) { if (!byDay.has(m.day)) byDay.set(m.day, []); byDay.get(m.day).push(m); }
      let shared = 0;
      for (const m of mine) if ([m.day - 1, m.day, m.day + 1].some(d => (byDay.get(d) ?? []).some(o => teamsMatch(o.h, m.h) && teamsMatch(o.a, m.a)))) shared++;
      const ratio = shared / Math.min(mine.length, theirs.length);
      if (shared) scored.push({target, shared, ratio});
    }
    scored.sort((a, b) => b.shared - a.shared);
    const [best, second] = scored;
    if (!best) continue;
    const strong = best.shared >= minMatches && best.ratio >= minMatchRatio && (!second || best.shared >= 2 * second.shared);
    if (!strong) {
      if (best.shared >= 2) reviews.push({kind: 'competition-merge', canonicalId: best.target.canonicalId, providerId: source.providerIds[0], name: source.name, reason: 'some shared matches with another competition; not enough to merge automatically', evidence: {basis: 'shared-matches', shared: best.shared, ratio: Math.round(best.ratio * 100) / 100, runnerUp: second?.shared ?? 0}});
      continue;
    }
    const target = best.target;
    for (const m of memberships) if (source.providerIds.includes(m.providerId)) { m.canonicalId = target.canonicalId; m.evidence = {basis: 'shared-matches', shared: best.shared, ratio: Math.round(best.ratio * 100) / 100, mergedFrom: source.canonicalId}; }
    const members = [...target.providerIds, ...source.providerIds].map(id => recordOf.get(id)).filter(Boolean);
    const anchor = members.find(m => m.record.id === target.providerIds[0]);
    const merged = summarize(target.canonicalId, [anchor, ...members.filter(m => m !== anchor)], fixturesBy);
    groups.splice(groups.indexOf(target), 1, merged); groups.splice(groups.indexOf(source), 1);
    live.delete(source.canonicalId);
    // Later comparisons use the merged group.
    const i = order.indexOf(target); if (i >= 0) order[i] = merged;
  }
}

function summarize(canonicalId, members, fixturesBy) {
  const id = members[0].identity, seen = new Map(), teams = new Set(), seasons = new Set(), stages = new Map();
  let distinct = 0;
  for (const m of members) {
    if (m.identity.season) seasons.add(m.identity.season);
    if (m.identity.stage || m.identity.group) { const s = m.identity.stage ?? (m.identity.group ? 'Group stage' : 'Main stage'); if (!stages.has(s)) stages.set(s, new Set()); if (m.identity.group) stages.get(s).add(m.identity.group); }
    for (const f of fixturesBy.get(m.record.id) ?? []) {
      teams.add(f.h).add(f.a);
      // Same match from two providers: both teams match (provider name variants) within a day, inside the same
      // canonical competition. Distinct canonical fixtures only.
      if ([f.day - 1, f.day, f.day + 1].some(d => (seen.get(d) ?? []).some(o => teamsMatch(o.h, f.h) && teamsMatch(o.a, f.a)))) continue;
      if (!seen.has(f.day)) seen.set(f.day, []); seen.get(f.day).push(f); distinct++;
    }
  }
  return {canonicalId, name: id.name, country: id.country, governingBody: id.governingBody, continent: id.continent, type: id.type, tier: id.tier, gender: id.gender, age: id.age,
    scopeKind: id.scopeKind, providerIds: members.map(m => m.record.id), providers: [...new Set(members.map(m => m.record.provider))], aliases: [...new Set(members.map(m => m.record.name))],
    seasons: [...seasons].sort(), stages: [...stages].map(([name, g]) => ({name, groups: [...g].sort()})), distinctFixtures: distinct, distinctTeams: teams.size,
    providerRows: members.reduce((n, m) => n + m.fixtures, 0)};
}

const STATUS_RANK = s => (['FT', 'AET', 'PEN', 'FINISHED'].includes(s) ? 3 : ['1H', '2H', 'HT', 'ET', 'LIVE', 'IN_PLAY', 'P', 'BT'].includes(s) ? 2 : ['PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(s) ? 1 : 0);
/**
 * Display de-duplication inside one canonical competition: the same match reported by several providers
 * (both teams match, kickoff within a day) is shown once, preferring a final, scored observation. Every
 * provider claim is kept in sourceClaims. Fixture records themselves are never merged or altered.
 */
export function dedupeAcrossProviders(fixtures) {
  const out = [], byDay = new Map();
  for (const f of [...fixtures].sort((a, b) => STATUS_RANK(b.status) - STATUS_RANK(a.status) || (b.homeScore != null) - (a.homeScore != null))) {
    const day = Math.floor(f.startsAt / 86400000), h = normTeam(f.home?.name), a = normTeam(f.away?.name);
    const twin = [day - 1, day, day + 1].flatMap(d => byDay.get(d) ?? []).find(o => teamsMatch(o.h, h) && teamsMatch(o.a, a));
    const claims = f.sourceClaims ?? [{id: f.id, provider: f.provider, startsAt: f.startsAt, status: f.status, homeScore: f.homeScore, awayScore: f.awayScore}];
    if (twin) { twin.fixture.sourceClaims = [...(twin.fixture.sourceClaims ?? []), ...claims]; continue; }
    const kept = {...f, sourceClaims: claims};
    if (!byDay.has(day)) byDay.set(day, []); byDay.get(day).push({h, a, fixture: kept}); out.push(kept);
  }
  return out.sort((x, y) => y.startsAt - x.startsAt);
}
