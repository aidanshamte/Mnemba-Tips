// Match centre sections in the browser: populated vs unavailable states.
// A real stored match is loaded; its match-context response is altered in the browser only (route
// interception, never persisted) to exercise both states deterministically.
//   npx --yes --package=playwright@1.63.0 node scripts/browser-match-sections.mjs
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {delimiter, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {localOrigin} from './local-origin.mjs';
let driver;
try { driver = await import('playwright'); } catch {
  const entry = (process.env.PATH ?? '').split(delimiter).map(p => resolve(p, '../playwright/index.mjs')).find(existsSync);
  if (!entry) throw Error('Run with npx --package=playwright@1.63.0 to provide the Playwright driver.');
  driver = await import(pathToFileURL(entry).href);
}
const origin = await localOrigin();
const day = (await (await fetch(origin + '/api/intelligence?view=matchday&day=custom&from=2026-09-05&to=2026-09-06&timezone=UTC')).json()).fixtures?.[0]
  ?? (await (await fetch(origin + '/api/intelligence?view=overview')).json()).results?.[0];
assert.ok(day?.id, 'A stored match is required');
const browser = await driver.chromium.launch({headless: true, ...(process.env.MNEMBA_TEST_BROWSER ? {executablePath: process.env.MNEMBA_TEST_BROWSER} : {})});
const errors = [];
const populated = body => ({...body,
  details: {
    lineups: [{team: body.fixture.home, formation: '4-3-3', startXI: [{player: {name: 'Test Keeper', number: 1}}]}],
    injuries: [{team: body.fixture.away, player: {name: 'Test Absentee', reason: 'Knee injury'}}],
    fixture_events: [{team: body.fixture.home, time: {elapsed: 12}, player: {name: 'Test Scorer'}, type: 'Goal', detail: 'Normal Goal'}],
    fixture_statistics: [{team: body.fixture.home, statistics: [{type: 'Shots on Goal', value: 5}]}],
  },
  coverage: (body.coverage ?? []).map(c => ({...c, available: true, reason: null})),
  probableLineups: body.fixture ? [{team: body.fixture.home, label: 'Projected', players: [{id: 'p1', name: 'Test Starter', position: 'G', startingFrequency: 1}], method: 'Test', availability: 'Test'}] : [],
  news: [{id: 'news:test', publisher: 'Example', headline: 'Test headline mentioning the club'}]});
const empty = body => ({...body,
  details: {lineups: [], injuries: [], fixture_events: [], fixture_statistics: []},
  coverage: (body.coverage ?? []).map(c => ['Team sheets', 'Availability', 'Events', 'Statistics'].includes(c.name) ? {...c, available: false, reason: c.reason ?? 'Not supplied by a permitted source.'} : c),
  probableLineups: [], news: []});
try {
  for (const [label, transform] of [['populated', populated], ['unavailable', empty]]) {
    const page = await browser.newPage({viewport: {width: 390, height: 844}}); page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/intelligence?view=match-context*', async route => { const r = await route.fetch(); await route.fulfill({json: transform(await r.json())}); });
    await page.goto(origin + '/football/match/' + encodeURIComponent(day.id), {waitUntil: 'domcontentloaded'});
    await page.locator('.match-hero').waitFor();
    for (const summary of ['Lineups and player statistics', 'Related reporting']) await page.getByText(summary, {exact: true}).click();
    const unavailable = page.locator('.mt-unavailable');
    if (label === 'populated') {
      for (const heading of ['Recorded team sheets', 'Reported player availability', 'Match events', 'Match statistics']) await page.getByRole('heading', {name: heading}).waitFor();
      await page.getByText('Test Starter').waitFor();
      await page.getByRole('heading', {name: 'Test headline mentioning the club'}).waitFor();
      assert.equal(await unavailable.count(), 0, 'No unavailable panel when every section has data');
    } else {
      await unavailable.waitFor();
      const text = await unavailable.innerText();
      for (const name of ['Projected lineups', 'Confirmed lineups', 'Player availability', 'Match events', 'Match statistics']) assert.ok(text.includes(name), name);
      assert.equal(await page.getByRole('heading', {name: 'Match events'}).count(), 0);
      assert.equal(await page.locator('.match-center table').filter({hasText: 'Shots'}).count(), 0);
      await page.getByText('No stored news story mentions either club.').waitFor();
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow');
    console.log(`PASS ${label}`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: match centre renders stored sections and one concise unavailable state.');
} finally { await browser.close(); }
