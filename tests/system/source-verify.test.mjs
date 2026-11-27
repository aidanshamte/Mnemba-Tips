// robots.txt matching for the source checker (RFC 9309): wildcards and end anchors, longest match wins.
import test from 'node:test';
import assert from 'node:assert/strict';
import {robotsAllows, ruleMatches} from '../../lib/football/source-verify.mjs';

const NL = String.fromCharCode(10);
// Sanitized from production (bundesliga.com, 2026-11-27): only *.php, *.jsp and /de_old/ are disallowed for everyone.
const BUNDESLIGA = ['User-agent: *', 'Disallow: /de_old/', 'Disallow: /*.php$', 'Disallow: /*.jsp', 'User-agent: SeznamBot', 'Disallow: /', 'User-agent: MJ12bot', 'Disallow: /'].join(NL);

test('wildcard rules are matched as patterns, not cut into a prefix that blocks the whole site', () => {
  assert.equal(robotsAllows(BUNDESLIGA, '/en/bundesliga/news/injury-update-werder-bremen-12345'), true, 'official news page is allowed');
  assert.equal(robotsAllows(BUNDESLIGA, '/de_old/archive'), false);
  assert.equal(robotsAllows(BUNDESLIGA, '/page/index.php'), false);
  assert.equal(robotsAllows(BUNDESLIGA, '/page/index.php?x=1'), true, '$ anchors the end of the path');
  assert.equal(robotsAllows(BUNDESLIGA, '/a/b.jsp?x=1'), false, 'unanchored pattern matches anywhere after the prefix');
});

test('RFC 9309 matching and precedence', () => {
  assert.equal(ruleMatches('/fish', '/fish.html'), true); assert.equal(ruleMatches('/fish$', '/fish.html'), false); assert.equal(ruleMatches('/fish$', '/fish'), true);
  assert.equal(ruleMatches('/*/news/*.html', '/en/news/a.html'), true); assert.equal(ruleMatches('/*/news/*.html', '/en/sport/a.html'), false);
  assert.equal(ruleMatches('/', '/anything'), true);
  const own = ['User-agent: *', 'Disallow: /', 'User-agent: MnembaSourceCheck', 'Allow: /news/', 'Disallow: /'].join(NL);
  assert.equal(robotsAllows(own, '/news/a'), true, 'our own group takes precedence; longer Allow wins');
  assert.equal(robotsAllows(own, '/shop'), false);
  assert.equal(robotsAllows(['User-agent: *', 'Disallow: /'].join(NL), '/x'), false, 'a full disallow is still honoured');
  assert.equal(robotsAllows(null, '/x'), true, 'missing robots.txt allows');
});
