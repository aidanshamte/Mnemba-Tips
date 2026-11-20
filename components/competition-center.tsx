'use client';
// Canonical competition page: seasons → stages → groups → fixtures. Old provider competition URLs resolve here
// and are replaced in the address bar with the canonical URL.
import {CompetitionIdentity, TeamIdentity} from './football-identity';
import {useEffect, useMemo, useState} from 'react';
import PublicNav from './public-nav';
import {FixtureRow} from './fixture-row';
import {Skeleton, StatePanel, Notice} from './mt-ui';
import {routeToken} from '@/lib/football/consumer.mjs';

type Data = Record<string, any>;
export default function CompetitionCenter({id}: {id: string}) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(''), [season, setSeason] = useState('');
  useEffect(() => {
    const c = new AbortController();
    void fetch(`/api/intelligence?view=competition&id=${encodeURIComponent(id)}`, {signal: c.signal}).then(r => { if (!r.ok) throw Error('Competition data is temporarily unavailable.'); return r.json() as Promise<Data>; })
      .then((d: Data) => { setData(d); if (d.legacyId && d.canonicalId) window.history.replaceState(null, '', `/football/competition/${routeToken(d.canonicalId)}`); })
      .catch(e => { if (!c.signal.aborted) setError(String(e.message ?? e)); });
    return () => c.abort();
  }, [id]);
  const seasons: string[] = data?.competition?.seasons ?? [];
  const active = season || seasons[0] || '';
  const sections = useMemo(() => {
    const out = new Map<string, Map<string, Data[]>>();
    for (const f of (data?.fixtures ?? []) as Data[]) {
      if (active && f.season && f.season !== active) continue;
      const stage = f.stage ?? 'Matches', group = f.group ?? '';
      if (!out.has(stage)) out.set(stage, new Map()); const g = out.get(stage)!; if (!g.has(group)) g.set(group, []); g.get(group)!.push(f);
    }
    return [...out].map(([stage, groups]) => [stage, [...groups].sort(([a], [b]) => a.localeCompare(b))] as const);
  }, [data, active]);
  const c = data?.competition;
  const scope = c ? [c.country ?? c.governingBody, c.continent].filter(Boolean).join(' · ') : '';
  return <div className="intel"><main className="match-center"><PublicNav/>
    <h1><CompetitionIdentity id={c?.emblemId ?? c?.id} name={c?.name ?? 'Competition'} variant="large"/></h1>
    <p>{scope}{c?.gender === 'women' ? " · Women's" : ''}{c?.age ? ` · ${c.age}` : ''}{c?.tier ? ` · Tier ${c.tier}` : ''}</p>
    {error && <Notice kind="error">{error}</Notice>}
    {!data && !error ? <Skeleton lines={4} label="Loading competition"/> : data && !c ? <StatePanel kind="missing" title="Competition not found">This competition is not in the recorded coverage.</StatePanel> : c && <>
      <p className="mt-supporting">{data!.fixtures.length.toLocaleString()} distinct recorded fixtures · {data!.teams} teams · recorded results and schedules; source coverage varies by season.</p>
      {seasons.length > 1 && <div className="mt-chip-row" role="group" aria-label="Season">{seasons.map(s => <button key={s} type="button" aria-pressed={s === active} onClick={() => setSeason(s)}>{s}</button>)}</div>}
      {data!.standings?.rows?.length > 0 && (!active || data!.standings.season === active) && <section className="intel-panel"><h2>Table · {data!.standings.season}</h2><p className="mt-supporting">{data!.standings.label}.</p>
        <div className="table-scroll"><table><thead><tr>{['#', 'Team', 'P', 'W', 'D', 'L', 'GD', 'Pts'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{data!.standings.rows.map((r: Data) => <tr key={r.team.id}><td>{r.position}</td><td><a href={`/football/team/${routeToken(r.team.id)}`}><TeamIdentity id={r.team.id} name={r.team.name}/></a></td>{['played', 'wins', 'draws', 'losses', 'goalDifference', 'points'].map(k => <td key={k}>{r[k]}</td>)}</tr>)}</tbody></table></div></section>}
      {sections.length ? <div className="mt-fixture-groups">{sections.map(([stage, groups]) => <section key={stage} className="mt-fixture-group" aria-label={stage}>
        <header className="mt-fixture-group-head"><span>{stage}</span><small>{groups.reduce((n, [, l]) => n + l.length, 0)} matches</small></header>
        {groups.map(([group, list]) => <div key={group || 'all'}>{group && <h3 className="mt-label mt-group-label">{group}</h3>}{list.map(f => <FixtureRow key={f.id} f={f as Parameters<typeof FixtureRow>[0]['f']}/>)}</div>)}
      </section>)}</div> : <StatePanel kind="empty" title="No recorded fixtures for this season yet">Coverage varies by season and source. Check back after the next update.</StatePanel>}
      {c.aliases?.length > 1 && <p className="mt-supporting">Also recorded as: {c.aliases.filter((a: string) => a !== c.name).join(' · ')}</p>}
    </>}
  </main></div>;
}
