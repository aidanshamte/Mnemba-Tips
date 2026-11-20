'use client';
// Leagues directory: one card per canonical competition (lib/football/identity-migration.mjs catalogCompetitions).
// Stages, groups, qualification rounds and play-offs live inside the competition page, never as separate cards.
import {useMemo, useState} from 'react';
import {Search} from 'lucide-react';
import {CompetitionIdentity} from './football-identity';
import {SourceTag, StatePanel} from './mt-ui';
import {routeToken} from '@/lib/football/consumer.mjs';

type Competition = {
  id: string; name: string; providerIds?: string[]; emblemId?: string; country?: {name?: string | null; continent?: string | null}; governingBody?: string | null;
  scope?: 'domestic' | 'international'; gender?: string; age?: string | null; tier?: number | null; currentSeason?: string | null; fixtureCount?: number; teamCount?: number | null;
  coverage?: 'extensive' | 'partial' | 'limited'; active?: boolean; nextFixtureAt?: number | null; latestResultAt?: number | null;
};
const COVERAGE: Record<string, string> = {extensive: 'Extensive recorded data', partial: 'Partial recorded data', limited: 'Limited recorded data'};
const category = (c: Competition) => c.age ? 'youth' : c.gender === 'women' ? 'women' : 'men';
const regionOf = (c: Competition) => c.country?.name ?? c.governingBody ?? 'International';
const dateText = (ms?: number | null) => ms ? new Date(ms).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}) : null;

export default function LeaguesDirectory({competitions, onFixtures}: {competitions: Competition[]; onFixtures: (ids: string[]) => void}) {
  const [q, setQ] = useState(''), [continent, setContinent] = useState(''), [country, setCountry] = useState(''), [scope, setScope] = useState('');
  const [who, setWho] = useState(''), [tier, setTier] = useState(''), [activeOnly, setActiveOnly] = useState(false), [coverage, setCoverage] = useState('');
  const options = useMemo(() => ({
    continents: [...new Set(competitions.map(c => c.country?.continent).filter(Boolean) as string[])].sort(),
    countries: [...new Set(competitions.filter(c => !continent || c.country?.continent === continent).map(regionOf))].sort(),
  }), [competitions, continent]);
  const shown = competitions.filter(c => (!q || `${c.name} ${regionOf(c)}`.toLowerCase().includes(q.toLowerCase())) && (!continent || c.country?.continent === continent) && (!country || regionOf(c) === country)
    && (!scope || c.scope === scope) && (!who || category(c) === who) && (!tier || String(c.tier ?? '') === tier) && (!activeOnly || c.active) && (!coverage || c.coverage === coverage));
  const groups = new Map<string, Competition[]>();
  for (const c of shown) { const k = regionOf(c); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(c); }
  const select = (label: string, value: string, set: (v: string) => void, items: [string, string][]) =>
    <label className="mt-filter"><span>{label}</span><select value={value} onChange={e => set(e.target.value)} aria-label={label}><option value="">All</option>{items.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>;
  return <>
    <div className="intel-filters mt-league-filters">
      <label className="mt-filter mt-filter-search"><Search size={17} aria-hidden="true"/><input placeholder="Search competitions or countries" aria-label="Search competitions" value={q} onChange={e => setQ(e.target.value)}/></label>
      {select('Continent', continent, v => { setContinent(v); setCountry(''); }, options.continents.map(c => [c, c]))}
      {select('Country or region', country, setCountry, options.countries.map(c => [c, c]))}
      {select('Type', scope, setScope, [['domestic', 'Domestic'], ['international', 'International']])}
      {select('Category', who, setWho, [['men', 'Men'], ['women', 'Women'], ['youth', 'Youth']])}
      {select('Tier', tier, setTier, [['1', 'Top tier'], ['2', 'Second tier'], ['3', 'Third tier']])}
      {select('Coverage', coverage, setCoverage, [['extensive', 'Extensive'], ['partial', 'Partial'], ['limited', 'Limited']])}
      <button type="button" className="mt-chip" aria-pressed={activeOnly} onClick={() => setActiveOnly(v => !v)}>Active season only</button>
    </div>
    <p role="status" className="mt-supporting">{shown.length.toLocaleString()} {shown.length === 1 ? 'competition' : 'competitions'}</p>
    {!shown.length && <StatePanel kind="empty" title="No competitions match these filters">Clear a filter or search for another competition.</StatePanel>}
    {[...groups].map(([region, list]) => <section key={region} className="mt-league-group" aria-label={region}><h2 className="mt-label">{region}</h2><div className="intel-matches">
      {list.map(c => {
        const next = dateText(c.nextFixtureAt), last = dateText(c.latestResultAt);
        return <article className="intel-match intel-competition" key={c.id}>
          <h3><a className="mt-card-link" href={`/football/competition/${routeToken(c.id)}`}><CompetitionIdentity id={c.emblemId ?? c.id} name={c.name} variant="medium"/></a></h3>
          <p>{regionOf(c)}{c.currentSeason ? ` · Season ${c.currentSeason}` : ''}{category(c) !== 'men' ? ` · ${category(c) === 'women' ? "Women's" : c.age ?? 'Youth'}` : ''}</p>
          <p>{(c.teamCount ?? 0).toLocaleString()} teams · {(c.fixtureCount ?? 0).toLocaleString()} distinct fixtures</p>
          <SourceTag kind={c.coverage === 'limited' ? 'unavailable' : 'confirmed'} label={COVERAGE[c.coverage ?? 'limited']}/>
          <p>{next ? `Next fixture ${next}` : last ? `Latest result ${last}` : 'No dated fixture recorded'}</p>
          <button type="button" className="mt-card-action" onClick={() => onFixtures(c.providerIds ?? [c.id])}>Fixtures →</button>
        </article>;
      })}
    </div></section>)}
  </>;
}
