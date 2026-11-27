// Production 2026-11-27 16:20: priority-import used 76 s and a retried Gemini call outlasted the 240 s run deadline,
// so ai-explain saved nothing. It now runs before the bulk import and never starts an item with < 60 s left.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CRON_JOBS} from '../../lib/football/scheduled.mjs';
import {GEMINI_ITEM_RESERVE_MS} from '../../lib/football/gemini-intelligence.mjs';

test('ai-explain runs before the bulk historical import and keeps a per-item time reserve', () => {
  const jobs = CRON_JOBS['20 */3 * * *'];
  assert.ok(jobs.indexOf('ai-explain') >= 0 && jobs.indexOf('ai-explain') < jobs.indexOf('priority-import'));
  assert.ok(GEMINI_ITEM_RESERVE_MS >= 25000 + 30000, 'reserve covers one bounded 25 s call plus reads and writes');
});
