// Release browser check for an Azure revision label URL or the public domain.
//   npx --yes --package=playwright@1.63.0 node scripts/azure/release-browser.mjs <origin> <outDir>
// Optional: MNEMBA_TEST_BROWSER (Chrome path), MNEMBA_AXE (path to axe.min.js) for WCAG 2.1 A/AA scans.
// Data-aware: routes need real stored entities; an absent dataset is recorded as a gap, never faked.
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {delimiter, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
let driver;
try { driver = await import('playwright'); } catch {
  const entry = (process.env.PATH ?? '').split(delimiter).map(p => resolve(p, '../playwright/index.mjs')).find(existsSync);
  if (!entry) throw Error('Run with npx --package=playwright@1.63.0');
  driver = await import(pathToFileURL(entry).href);
}
const origin = new URL(process.argv[2]).origin, out = process.argv[3] ?? 'release-browser';
if (!/^https:\/\/([a-z0-9-]+\.)*(azurecontainerapps\.io|aidanshamte\.me)$/.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw Error('Unexpected origin');
mkdirSync(out, {recursive: true});
const report = {origin, at: new Date().toISOString(), pages: [], gaps: [], failures: [], axe: []};
const fail = m => report.failures.push(m), gap = m => report.gaps.push(m);
const json = async path => { const r = await fetch(origin + path, {signal: AbortSignal.timeout(90000)}); assert.equal(r.status, 200, path); return r.json(); };
const token = id => 'id-' + Array.from(new TextEncoder().encode(id), b => b.toString(16).padStart(2, '0')).join('');

// Real stored entities for dynamic routes.
const overview = await json('/api/intelligence?view=overview');
const fixture = [...(overview.results ?? []), ...(overview.upcoming ?? []), ...(overview.today ?? [])][0];
const firstHit = async (kind, queries) => { for (const q of queries) { const r = (await json(`/api/intelligence?view=global-search&kind=${kind}&q=${encodeURIComponent(q)}`)).results?.find(x => x.kind === kind); if (r) return r.url; } return null; };
const team = await firstHit('team', ['Arsenal', 'Bayern']), player = await firstHit('player', ['Messi', 'Kane']), competition = await firstHit('competition', ['Premier League', 'Bundesliga']);
const article = (await json('/api/intelligence?view=news')).articles?.[0];
const routes = {
  home: '/football', today: '/football?tab=Fixtures&day=today', tomorrow: '/football?tab=Fixtures&day=tomorrow', leagues: '/football?tab=Leagues', news: '/football?tab=News',
  searchTeam: '/football/search?kind=team&q=Arsenal', searchPlayer: '/football/search?kind=player&q=Messi', history: '/football/predictions', picks: '/football/shortlists', basketball: '/basketball',
  ...(fixture ? {match: '/football/match/' + encodeURIComponent(fixture.id)} : {}), ...(team ? {team} : {}), ...(player ? {player} : {}), ...(competition ? {competition} : {}),
  ...(article ? {article: '/football/news/' + token(article.id)} : {}),
};
if (!fixture) fail('No stored fixture for the match centre'); if (!team) fail('No stored team'); if (!player) gap('No stored player found for Messi/Kane'); if (!competition) fail('No stored competition');
if (!article) gap('The news view returned no stored stories; article page not exercised');

const browser = await driver.chromium.launch({headless: true, ...(process.env.MNEMBA_TEST_BROWSER ? {executablePath: process.env.MNEMBA_TEST_BROWSER} : {})});
const axe = process.env.MNEMBA_AXE && existsSync(process.env.MNEMBA_AXE) ? readFileSync(process.env.MNEMBA_AXE, 'utf8') : null;
try {
  for (const [w, h] of [[1440, 900], [768, 1024], [375, 812], [320, 568]]) for (const theme of w === 1440 || w === 375 ? ['light', 'dark'] : ['light']) {
    const ctx = await browser.newContext({viewport: {width: w, height: h}, isMobile: w < 768, hasTouch: w < 768, timezoneId: 'Africa/Dar_es_Salaam'});
    const page = await ctx.newPage(), errors = [], api5xx = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    page.on('response', r => { if (r.url().startsWith(origin + '/api/') && r.status() >= 500) api5xx.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    for (const [name, path] of Object.entries(routes)) {
      if (theme === 'dark' && !['home', 'match', 'team', 'article'].includes(name)) continue;
      const started = Date.now(); let status = 0;
      try {
        const resp = await page.goto(origin + path, {waitUntil: 'networkidle', timeout: 90000}); status = resp?.status() ?? 0;
        await page.locator('h1').first().waitFor({timeout: 30000});
        if (theme === 'dark') { await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await page.waitForTimeout(300); }
        await page.waitForTimeout(800);
        const m = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          logo: [...document.querySelectorAll('.mt-brand img, .mt-studio-brand img')].filter(i => i.offsetParent).map(i => ({ok: i.complete && i.naturalWidth > 0, src: i.currentSrc.split('/').pop()})),
          brokenImages: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0 && i.src && i.offsetParent).map(i => i.src).slice(0, 5),
          // Same rule as the release responsive sweep: a target smaller than 44px in both dimensions.
          small: [...document.querySelectorAll('a,button,input,select,summary,[role=button]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).visibility !== 'hidden' && r.height < 44 && r.width < 44; }).map(e => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30)),
          h1: document.querySelector('h1')?.textContent?.trim().slice(0, 60),
        }));
        const row = {name, w, theme, status, ms: Date.now() - started, ...m};
        report.pages.push(row);
        if (status !== 200) fail(`${name}@${w}/${theme}: HTTP ${status}`);
        if (m.overflow) fail(`${name}@${w}/${theme}: horizontal overflow`);
        if (!m.logo.length || m.logo.some(l => !l.ok)) fail(`${name}@${w}/${theme}: approved logo not rendered`);
        if (m.brokenImages.length) fail(`${name}@${w}/${theme}: broken images ${m.brokenImages.join(', ')}`);
        if (m.small.length) fail(`${name}@${w}/${theme}: touch targets under 44px: ${m.small.join(' | ')}`);
        if (w === 1440 || w === 375) await page.screenshot({path: `${out}/${name}-${w}-${theme}.png`});
        if (axe && theme === 'light' && (w === 1440 || w === 375) && ['home', 'match', 'team', 'history', 'searchTeam', 'article'].includes(name)) {
          await page.addScriptTag({content: axe});
          const v = await page.evaluate(async () => (await window.axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}})).violations.map(x => `${x.id}(${x.nodes.length})`));
          report.axe.push({name, w, violations: v}); if (v.length) fail(`${name}@${w}: axe ${v.join(' ')}`);
        }
      } catch (e) { fail(`${name}@${w}/${theme}: ${e.message.split('\n')[0].slice(0, 160)}`); }
    }
    if (errors.length) fail(`page errors @${w}/${theme}: ${[...new Set(errors)].join(' | ')}`);
    if (api5xx.length) fail(`API 5xx @${w}/${theme}: ${[...new Set(api5xx)].join(', ')}`);
    // Mobile navigation sheet.
    if (w === 375 && theme === 'light') {
      try {
        await page.goto(origin + '/football', {waitUntil: 'networkidle'}); await page.locator('.mt-bottom-nav button').click();
        const d = page.locator('dialog[aria-label=Menu]'); assert.equal(await d.evaluate(e => e.open), true);
        await page.keyboard.press('Escape'); assert.equal(await d.evaluate(e => e.open), false); report.mobileMenu = 'pass';
      } catch (e) { fail('mobile menu: ' + e.message.split('\n')[0]); }
    }
    await ctx.close();
  }
  // Visitor-local timezone: the same kickoff renders differently per browser timezone.
  if (fixture && fixture.kickoffPrecision !== 'date') {
    const texts = {};
    for (const tz of ['America/New_York', 'Asia/Tokyo']) {
      const ctx = await browser.newContext({timezoneId: tz}); const p = await ctx.newPage();
      await p.goto(origin + routes.match, {waitUntil: 'networkidle', timeout: 90000}); await p.locator('.match-hero').waitFor();
      texts[tz] = (await p.locator('.match-hero').innerText()).match(/\d{1,2}:\d{2}[^\n·]*/)?.[0] ?? null; await ctx.close();
    }
    report.timezone = texts; if (!texts['America/New_York'] || texts['America/New_York'] === texts['Asia/Tokyo']) fail('kickoff did not follow the visitor timezone: ' + JSON.stringify(texts));
  } else gap('No timed fixture available for the timezone check');
} finally { await browser.close(); }
report.passed = report.failures.length === 0;
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({origin, passed: report.passed, pages: report.pages.length, failures: report.failures, gaps: report.gaps, timezone: report.timezone, mobileMenu: report.mobileMenu, axe: report.axe.map(a => `${a.name}@${a.w}:${a.violations.length}`)}, null, 1));
if (!report.passed) process.exit(1);
