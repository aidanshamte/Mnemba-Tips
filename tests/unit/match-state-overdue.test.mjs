// Stale live statuses must be visible as unconfirmed, never presented as live, and never inferred complete.
import test from 'node:test';
import assert from 'node:assert/strict';
import {matchState, LIVE_STALE_MS} from '../../lib/football/match-state.mjs';

const kickoff = Date.parse('2026-11-20T00:30:00Z');
const live = {status: '2H', startsAt: kickoff, kickoffPrecision: 'instant'};

test('a recently started live match is in progress', () => {
  const s = matchState(live, kickoff + 70 * 60000);
  assert.equal(s.state, 'live'); assert.equal(s.label, 'In progress'); assert.equal(s.needsRefresh, false);
});

test('a live status long after kickoff is shown as unconfirmed, not live, and not completed', () => {
  const s = matchState(live, kickoff + LIVE_STALE_MS + 60000);
  assert.equal(s.label, 'Result not confirmed');
  assert.equal(s.overdue, true);
  assert.equal(s.needsRefresh, true);
  assert.equal(s.state, 'live', 'completion is never inferred from the clock');
  assert.equal(s.previewAllowed, false);
  assert.equal(s.forecastEligible, false);
  assert.match(s.notice, /not presented as live/);
});

test('final, scheduled and half-time states are unaffected by the threshold', () => {
  const late = kickoff + 2 * LIVE_STALE_MS;
  assert.equal(matchState({...live, status: 'FT'}, late).state, 'completed');
  assert.equal(matchState({...live, status: 'HT'}, kickoff + 50 * 60000).label, 'In progress');
  assert.equal(matchState({...live, status: 'NS', startsAt: late + 3600000}, late).label, 'Scheduled');
});
