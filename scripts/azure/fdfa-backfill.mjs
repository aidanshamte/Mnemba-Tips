// Resumable 5DollarFootballAPI history backfill, run manually on the existing mnemba-import job (no schedule).
//
//   FIVE_DOLLAR_FOOTBALL_API_KEY=(secretRef) DATABASE_URL=(secretRef) MNEMBA_DATABASE_SCHEMA=production_snapshot \
//   MNEMBA_BACKFILL_MINUTES=50 MNEMBA_BACKFILL_PAGES=12 node scripts/azure/fdfa-backfill.mjs
//
// - Works league by league (12 months on Pro), checkpointed per page (football_cache "fdfa:history:<league>"); an
//   interrupted run resumes where it stopped.
// - Shares the database rate limiter with the scheduled jobs (never more than 9 requests per clock minute in total),
//   honours Retry-After and the circuit breaker, and stops cleanly at its time limit.
// - Holds its own lease ("fdfa-backfill"), so two backfills cannot overlap. It does not take the scheduled jobs'
//   advisory lock, so they keep running; writes are idempotent upserts of finished matches only.
// - Never prints the key; prints only counts.
import {createPool, postgresDatabase} from '../../lib/azure/postgres.mjs';
import {Store} from '../../lib/football/store.mjs';
import {IntelligenceService} from '../../lib/football/intelligence.mjs';
import {FiveDollarClient, backfillHistory, fdfaState, FdfaStop} from '../../lib/football/fivedollar.mjs';

const minutes = Number(process.env.MNEMBA_BACKFILL_MINUTES ?? 50), maxPages = Number(process.env.MNEMBA_BACKFILL_PAGES ?? 12);
const pool = createPool(), store = new Store(postgresDatabase(pool)), out = {minutes, maxPages};
let owner = null;
try {
  const state = fdfaState(process.env);
  if (!state.enabled) throw new FdfaStop(state.reason);
  const service = new IntelligenceService(store, {...process.env, MNEMBA_SCHEMA_MANAGED: '1'}, {});
  await service.initialize();
  owner = await store.lock('fdfa-backfill', (minutes + 5) * 60000);
  if (!owner) throw new FdfaStop('Another backfill is running');
  const started = Date.now(), client = new FiveDollarClient(service, {budget: Infinity, stopAt: started + minutes * 60000});
  const catalog = await client.leagues(), summary = {history: {leagues: 0, pages: 0, fixtures: 0, inserted: 0, rejected: 0}};
  try { await backfillHistory(service, client, catalog, summary, {maxPages, upcomingOnly: false}); out.complete = true; }
  catch (error) { if (error instanceof FdfaStop) { out.complete = false; out.stoppedBecause = error.message; } else throw error; }
  out.requests = client.requests; out.seconds = Math.round((Date.now() - started) / 1000);
  out.leaguesCompleted = summary.history.leagues; out.pages = summary.history.pages; out.fixtures = summary.history.fixtures; out.inserted = summary.history.inserted; out.rejected = summary.history.rejected;
  out.leaguesTouched = Object.keys(summary.history.perLeague ?? {}).length;
  out.remaining = (await store.all("SELECT id,payload FROM football_cache WHERE id LIKE 'fdfa:history:%'")).filter(r => !JSON.parse(r.payload).done).length;
} catch (error) { out.error = error instanceof FdfaStop ? error.message : `${error.name}: ${error.message}`; process.exitCode = error instanceof FdfaStop ? 0 : 1; }
finally { if (owner) await store.unlock('fdfa-backfill', owner); await pool.end(); }
console.log('fdfa_backfill ' + JSON.stringify(out));
