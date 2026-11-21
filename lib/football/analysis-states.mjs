// Analysis state for every visible, not-started fixture, precomputed by the scheduled jobs.
//
// Production 2026-11-21/22: 94 of 168 and 181 of 219 not-started fixtures showed no estimate only because nothing had
// computed one ("a saved prediction is not available yet"); estimates were built on request, and the matchday view only
// analysed ~24 named priority leagues. Eligibility now depends on evidence, not on a league's fame.
//
// States:
//   full        valid probabilities, at least 8 earlier matches per team, both active within 90 days, a validated model
//               category (not women/youth, which have no validated parameters)
//   provisional valid probabilities from at least 3 earlier matches per team; wider uncertainty, no recommendation
//   waiting     the fixture is real and visible, but there is not enough verified evidence for a responsible estimate
// A top pick is a full analysis whose recommendation passes decideRecommendation (60-85% band, sample, rest) and the
// matchday ranking. Tracked pre-kickoff forecasts are captured by the models batch; this stage saves exploratory
// estimates only.
import {matchState, analysisCutoff} from './match-state.mjs';
import {savedEstimate} from './estimates.mjs';
import {decideRecommendation} from './recommendations.mjs';
import {ModelLab} from './model-lab.mjs';

export const STATE_LABELS = {full: 'Full analysis', provisional: 'Early estimate', waiting: 'Waiting for data'};
const DAY = 86400000, HOUR = 3600000;
const validProbabilities = p => Array.isArray(p) && p.length === 3 && p.every(x => Number.isFinite(x) && x >= 0 && x <= 1) && Math.abs(p.reduce((n, x) => n + x, 0) - 1) < 0.001;
const OUTCOMES = ['Home win', 'Draw', 'Away win'];

export function classifyAnalysis(f, a, rec) {
  const sample = Math.min(a?.factors?.home?.games ?? 0, a?.factors?.away?.games ?? 0);
  const rest = Math.max(a?.factors?.home?.restDays ?? Infinity, a?.factors?.away?.restDays ?? Infinity);
  const probabilities = validProbabilities(a?.probabilities) ? a.probabilities : null;
  const unvalidatedCategory = /No validated model for this age\/gender category/.test(rec?.reason ?? '');
  let state = 'waiting';
  if (probabilities && sample >= 8 && rest <= 90 && !unvalidatedCategory && !f.hasConflict) state = 'full';
  else if (probabilities && sample >= 3) state = 'provisional';
  const best = probabilities ? probabilities.indexOf(Math.max(...probabilities)) : -1;
  const reason = state === 'waiting'
    ? (sample > 0 && sample < 3 ? `Only ${sample} earlier recorded match${sample === 1 ? '' : 'es'} for one of the teams; at least 3 are needed.` : 'Analysis is waiting for enough verified data.')
    : state === 'provisional'
      ? (unvalidatedCategory ? 'Early estimate: no validated model for this age or gender category yet.' : sample < 8 ? `Early estimate from ${sample} earlier matches per team; wider uncertainty.` : 'Early estimate: a team has not played within 90 days.')
      : (a?.explanations?.[0] ?? 'Based on earlier results, form and home advantage.');
  return {
    state, label: STATE_LABELS[state], sample, reason,
    probabilities: probabilities ? probabilities.map(p => Math.round(p * 1000) / 1000) : null,
    main: best >= 0 && state !== 'waiting' ? {outcome: OUTCOMES[best], probability: Math.round(probabilities[best] * 1000) / 1000} : null,
    expectedGoals: state !== 'waiting' && Array.isArray(a?.expectedGoals) ? a.expectedGoals.map(x => Math.round(x * 100) / 100) : null,
    recommendation: state === 'full' && rec?.primary ? {primary: rec.primary, alternatives: rec.alternatives, rank: rec.rank, reasons: rec.reasons, uncertainty: rec.uncertainty, sample: rec.sample} : null,
    modelVersion: a?.modelVersion ?? null, estimateKind: a?.estimateKind ?? null, savedAt: a?.asOf ?? null,
  };
}

/** Targeted read of cached states for the fixtures in hand (never a whole-table read). */
export async function analysisStates(store, ids) {
  const out = new Map(), list = [...new Set(ids)];
  for (let i = 0; i < list.length; i += 400) {
    const chunk = list.slice(i, i + 400).map(id => `analysis:${id}`);
    for (const r of await store.all(`SELECT id,payload,expires_at FROM football_cache WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk))
      if (Number(r.expires_at) > store.now()) out.set(r.id.slice('analysis:'.length), JSON.parse(r.payload));
  }
  return out;
}

/**
 * Compute states for visible, not-started fixtures from now to `horizonMs` ahead, stalest first, until `stopAt`.
 * Resumable: each fixture's state is cached for 6 hours (1 hour within 6 hours of kickoff).
 */
export async function computeAnalysisStates(service, {stopAt = Infinity, horizonMs = 2 * DAY, visible, captureLimit = 25} = {}) {
  const s = service.store, now = s.now(), summary = {considered: 0, computed: 0, fresh: 0, full: 0, provisional: 0, waiting: 0, stoppedEarly: false};
  const raw = (await s.all("SELECT payload FROM fixtures WHERE starts_at>? AND starts_at<? AND status IN ('NS','TBD','TIMED','SCHEDULED') ORDER BY starts_at", now, now + horizonMs)).map(r => JSON.parse(r.payload));
  const shown = visible ? await visible(raw) : raw;
  const fixtures = (await service.deduplicateFixtures(shown)).filter(f => matchState(f, now).previewAllowed);
  summary.considered = fixtures.length;
  const cached = await analysisStates(s, fixtures.map(f => f.id));
  const due = fixtures.filter(f => !cached.has(f.id) || (f.startsAt - now < 6 * HOUR && now - (cached.get(f.id).computedAt ?? 0) > HOUR));
  summary.fresh = fixtures.length - due.length;
  for (const f of due) {
    if (s.now() >= stopAt) { summary.stoppedEarly = true; break; }
    const history = await service.history(f.home.id, f.away.id, analysisCutoff(f, s.now()), f.id);
    const a = await savedEstimate(service, f, history, {capture: false}), rec = decideRecommendation(f, a, s.now());
    const state = {...classifyAnalysis(f, a, rec), fixtureId: f.id, canonicalId: f.canonicalId ?? f.id, kickoff: f.startsAt, computedAt: s.now()};
    await s.putCache(`analysis:${f.id}`, state, f.startsAt - s.now() < 6 * HOUR ? HOUR : 6 * HOUR);
    summary.computed++; summary[state.state]++;
  }
  // Tracked forecasts without waiting for the next daily model batch: full analyses with no saved forecast for this
  // kickoff are captured now (immutable; model version, cutoff and evidence snapshot; never at or after kickoff).
  // Capture rebuilds point-in-time history (about 0.8 s each in production), so it is bounded to the soonest 25 per run
  // and always stops at the stage time box.
  summary.captured = 0; summary.captureSkipped = 0;
  const lab = new ModelLab(service), latest = await analysisStates(s, fixtures.map(f => f.id));
  const due2 = fixtures.filter(f => latest.get(f.id)?.state === 'full' && f.startsAt > s.now()).sort((a, b) => a.startsAt - b.startsAt);
  for (const f of due2) {
    if (summary.captured + summary.captureSkipped >= captureLimit || s.now() >= stopAt) break;
    if (await s.one('SELECT id FROM analysis_forecasts WHERE fixture_id=? AND kickoff_at=?', f.id, f.startsAt)) continue;
    const r = await lab.capture(f);
    if (r?.forecasts > 0) summary.captured++; else summary.captureSkipped++;
  }
  return summary;
}
