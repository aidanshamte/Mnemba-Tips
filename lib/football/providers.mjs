export const namespace = (provider, id) => `${provider}:${id}`;
export const LIVE = new Set(['1H','HT','2H','ET','BT','P','LIVE','IN_PLAY','PAUSED']);
export const FINAL = new Set(['FT','AET','PEN','FINISHED']);
export const SCHEDULED = new Set(['NS','TBD','SCHEDULED','TIMED']);
export const labelFor = status => LIVE.has(status) ? 'Live' : FINAL.has(status) ? 'Historical' : 'Confirmed';
const required = (value, field) => { if (value === null || value === undefined || value === '') throw new Error(`Provider missing ${field}`); return value; };
const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export function normalizeCompetition(provider, value) {
  const api = provider === 'api-football';
  const league = api ? value.league : value;
  const country = api ? value.country : value.area;
  const id = namespace(provider, required(league.id, 'competition ID'));
  const countryKey=api?(country?.code||country?.name):(country?.id||country?.code||country?.name);
  return { id, provider, externalId: String(league.id), name: required(league.name, 'competition name'), type: league.type ?? null,
    country: country?.name ? { id: namespace(provider, countryKey), provider, externalId: String(countryKey), name: country.name, code: country.code ?? country.countryCode ?? null, continent: country.continent ?? null } : null,
    seasons: (api ? value.seasons ?? [] : [value.currentSeason].filter(Boolean)).map(s => ({ id: `${id}:${s.year ?? new Date(s.startDate).getUTCFullYear()}`, competitionId: id, year: s.year ?? new Date(s.startDate).getUTCFullYear(), current: api ? !!s.current : true, coverage: api ? s.coverage ?? {} : { fixtures: true, standings: 'plan-dependent', scorers: 'plan-dependent', lineups: 'plan-dependent' }, start: s.start ?? s.startDate, end: s.end ?? s.endDate })) };
}
export function normalizeFixture(provider, value) {
  const api = provider === 'api-football';
  const fixture = api ? value.fixture : value;
  const competition = api ? { league: value.league, country: { name: value.league.country }, seasons: [{ year: value.league.season }] } : { ...value.competition, area: value.area, currentSeason: value.season };
  const comp = normalizeCompetition(provider, competition);
  const home = api ? value.teams?.home : value.homeTeam, away = api ? value.teams?.away : value.awayTeam;
  const team = t => ({ id: namespace(provider, required(t?.id, 'team ID')), provider, externalId: String(t.id), name: required(t.name, 'team name'), logo: t.logo ?? t.crest ?? null });
  const startsAt = Date.parse(api ? fixture.date : value.utcDate);
  if (!Number.isFinite(startsAt) || !comp.seasons.length) throw new Error('Provider missing fixture date or season');
  const status = required(api ? fixture.status?.short : value.status, 'status');
  return { id: namespace(provider, required(fixture.id, 'fixture ID')), provider, externalId: String(fixture.id), competition: comp, seasonId: comp.seasons[0].id,
    home: team(home), away: team(away), startsAt, status, elapsed: number(api ? fixture.status.elapsed : value.minute), venue: api ? fixture.venue?.name ?? null : value.venue ?? null,
    regulationScore: api&&value.score?.fulltime?{home:number(value.score.fulltime.home),away:number(value.score.fulltime.away)}:!api&&value.score?.duration==='REGULAR'?{home:number(value.score.fullTime?.home),away:number(value.score.fullTime?.away)}:null,
    homeScore: number(api ? value.goals?.home : value.score?.fullTime?.home), awayScore: number(api ? value.goals?.away : value.score?.fullTime?.away), label: labelFor(status), sourceUpdatedAt: value.lastUpdated ?? null };
}

export class Provider {
  constructor(name, key, store, { fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) { this.name = name; this.key = key; this.store = store; this.fetcher = (...args) => fetcher(...args); this.sleep = sleep; }
  async request(path, params = {}, category = 'fixtures') {
    if (!this.key) throw new Error(`${this.name} not configured`);
    const api = this.name === 'api-football';
    const url = new URL(path, api ? 'https://v3.football.api-sports.io/' : 'https://api.football-data.org/v4/');
    for (const [key, value] of Object.entries(params)) if (value !== '' && value != null) url.searchParams.set(key, String(value));
    for (let attempt = 0; attempt < 3; attempt++) {
      if (api) await this.store.reserve(attempt ? 'retry' : category);
      else {
        const slot = await this.store.lock('football-data-rate', 6500);
        if (!slot) throw new Error('Football-Data rate slot busy; serving cache');
      }
      let response;
      try { response = await this.fetcher(url, { headers: api ? { 'x-apisports-key': this.key } : { 'X-Auth-Token': this.key }, signal: AbortSignal.timeout(15000), redirect: 'manual' }); }
      catch { if (attempt === 2) throw new Error(`${this.name} network unavailable`); await this.sleep(1000 * 2 ** attempt); continue; }
      if (api && response.headers.has('x-ratelimit-requests-remaining')) await this.store.providerRemaining(Number(response.headers.get('x-ratelimit-requests-remaining')));
      if (response.status === 429 || response.status >= 500) {
        if (api && response.status === 429 && response.headers.get('x-ratelimit-requests-remaining') === '0') throw new Error('Provider quota exhausted');
        if (attempt === 2) throw new Error(`${this.name} temporarily unavailable (${response.status})`);
        const retry = response.headers.get('retry-after');
        const delay = retry ? (Number(retry) * 1000 || Date.parse(retry) - this.store.now()) : 0;
        // Long Retry-After is persisted, rather than holding an HTTP request open.
        if (delay > 20000) { await this.store.putCache(`backoff:${this.name}`, true, delay); throw new Error(`${this.name} requested backoff`); }
        await this.sleep(Math.max(api ? 1000 : 6500, delay, 1000 * 2 ** attempt)); continue;
      }
      if (!response.ok) throw new Error(`${this.name} returned ${response.status}`);
      const body = await response.json();
      if (api && Object.keys(body.errors ?? {}).length) throw new Error('API-Football rejected the request; check plan coverage and parameters');
      if (api && !(Array.isArray(body.response)||(path==='teams/statistics'&&body.response&&typeof body.response==='object'))) throw new Error('Invalid API-Football response');
      return body;
    }
  }
}

// These names classify discovered records; they never create competitions.
export const FEATURED = [
 ['UEFA Champions League', /^(UEFA )?Champions League$/i, /^(Europe|World)$/i], ['UEFA Europa League', /^(UEFA )?Europa League$/i], ['UEFA Conference League', /^(UEFA )?(Europa )?Conference League$/i],
 ['Premier League', /^Premier League$/i, /England/i], ['La Liga', /^(La Liga|Primera Division)$/i, /Spain/i], ['Bundesliga', /^(1\. )?Bundesliga$/i, /Germany/i], ['Serie A', /^Serie A$/i, /Italy/i], ['Ligue 1', /^Ligue 1$/i, /France/i], ['Primeira Liga', /^Primeira Liga$/i], ['Eredivisie', /^Eredivisie$/i], ['Scottish Premiership', /Premiership/i, /Scotland/i], ['MLS', /Major League Soccer|^MLS$/i], ['Liga MX', /^Liga MX$/i], ['Brazilian Série A', /S[eé]rie A/i, /Brazil/i], ['Argentina Primera División', /Liga Profesional Argentina|Primera Divisi[oó]n/i, /Argentina/i], ['Saudi Pro League', /Pro League/i, /Saudi/i], ['CAF Champions League', /^CAF Champions League$/i], ['African Cup of Nations', /Africa(n)? Cup of Nations/i], ['FIFA World Cup', /^(FIFA )?World Cup$/i], ['European Championship', /Euro Championship|European Championship/i], ['Copa América', /Copa Am[eé]rica/i],
];
export function featuredCategory(c) { return FEATURED.find(([, name, country]) => name.test(c.name) && (!country || country.test(c.country?.name ?? '')))?.[0] ?? null; }
