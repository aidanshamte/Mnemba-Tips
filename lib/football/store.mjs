import {cronMigration} from './schema-v8.mjs';
import {recommendationMigration} from './schema-v7.mjs';
import {lifecycleMigration} from './schema-v6.mjs';
import {estimateMigration} from './schema-v5.mjs';
import {forecastMigration} from './schema-v4.mjs';
import {searchMigration} from './schema-v3.mjs';
import { migration } from './schema.mjs';
import { intelligenceMigration } from './schema-v2.mjs';

export const ALLOCATIONS = Object.freeze({ live: 48, fixtures: 10, details: 20, statistics: 10, retry: 8, reserve: 4 });
export class QuotaError extends Error { constructor() { super('Daily request allocation exhausted'); this.name = 'QuotaError'; } }
export class Store {
  constructor(db, now = Date.now) { this.db = db; this.now = now; }
  async init() { await this.db.batch([...migration,...intelligenceMigration,...searchMigration,...forecastMigration,...estimateMigration,...lifecycleMigration,...recommendationMigration,...cronMigration].map(sql => this.db.prepare(sql))); }
  async batch(statements) { for(let i=0;i<statements.length;i+=75) await this.db.batch(statements.slice(i,i+75).map(([sql,...args])=>this.db.prepare(sql).bind(...args))); }
  async all(sql, ...args) { return (await this.db.prepare(sql).bind(...args).all()).results; }
  async one(sql, ...args) { return this.db.prepare(sql).bind(...args).first(); }
  async run(sql, ...args) { return this.db.prepare(sql).bind(...args).run(); }
  async upsert(table, row) {
    if (!/^[a-z_]+$/.test(table) || !Object.keys(row).every(k => /^[a-z_]+$/.test(k))) throw new Error('Invalid table');
    const keys = Object.keys(row);
    const tracked=this.writeStats&&['countries','competitions','seasons','football_teams','football_players','fixtures','news_articles','lineups','injuries','fixture_events','fixture_statistics','standings','football_appearances'].includes(table);
    const old=tracked?await this.one(`SELECT * FROM ${table} WHERE id=?`,row.id):null;
    try{const result=await this.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${keys.filter(k => k !== 'id').map(k => `${k}=excluded.${k}`).join(',')}`, ...Object.values(row));
    if(tracked)this.writeStats[!old?'inserted':keys.filter(k=>k!=='updated_at').every(k=>old[k]===row[k])?'duplicate':'updated']++;return result;
    }catch(error){if(tracked)this.writeStats.failed++;throw error;}
  }
  async lock(id, ttl = 120000) {
    const owner = crypto.randomUUID(), now = this.now();
    const row = await this.one('INSERT INTO sync_locks(id,owner,expires_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at WHERE sync_locks.expires_at <= ? RETURNING owner', id, owner, now + ttl, now);
    return row?.owner === owner ? owner : null;
  }
  async unlock(id, owner) { await this.run('DELETE FROM sync_locks WHERE id=? AND owner=?', id, owner); }
  async cache(id) { const row = await this.one('SELECT * FROM football_cache WHERE id=?', id); return row ? { data: JSON.parse(row.payload), updatedAt: row.updated_at, stale: row.expires_at <= this.now() } : null; }
  async putCache(id, data, ttl) { await this.upsert('football_cache', { id, payload: JSON.stringify(data), updated_at: this.now(), expires_at: this.now() + ttl }); }
  day() { return new Date(this.now()).toISOString().slice(0, 10); }
  async budget() {
    const day = this.day();
    const rows = await this.all('SELECT category,used FROM api_request_usage WHERE provider=? AND day=?', 'api-football', day);
    const used = rows.reduce((n, r) => n + r.used, 0);
    const limit = await this.one('SELECT remaining FROM provider_limits WHERE provider=? AND day=?', 'api-football', day);
    return { limit: 100, used, remaining: Math.min(100 - used, limit?.remaining ?? 100), allocations: ALLOCATIONS, categories: Object.fromEntries(rows.map(r => [r.category, r.used])), resetAt: new Date(Date.parse(day) + 86400000).toISOString(), automaticLimit: 96 };
  }
  async reserve(category) {
    if (!ALLOCATIONS[category]) throw new Error('Invalid budget category');
    const day = this.day();
    // A single conditional SQLite write serializes concurrent workers. Attempts count even if fetch fails.
    const result = await this.one(`INSERT INTO api_request_usage(provider,day,category,used)
      SELECT 'api-football',?,?,1 WHERE
      COALESCE((SELECT SUM(used) FROM api_request_usage WHERE provider='api-football' AND day=?),0) < ?
      AND COALESCE((SELECT remaining FROM provider_limits WHERE provider='api-football' AND day=?),100) > 0
      ON CONFLICT(provider,day,category) DO UPDATE SET used=api_request_usage.used+1
      WHERE api_request_usage.used < ? RETURNING used`, day, category, day, category === 'reserve' ? 100 : 96, day, ALLOCATIONS[category]);
    if (!result) throw new QuotaError();
    await this.run("UPDATE provider_limits SET remaining=MAX(0,remaining-1) WHERE provider='api-football' AND day=?", day);
  }
  async providerRemaining(value) {
    if (!Number.isFinite(value) || value < 0) return;
    await this.run("INSERT INTO provider_limits(provider,day,remaining) VALUES('api-football',?,?) ON CONFLICT(provider,day) DO UPDATE SET remaining=MIN(provider_limits.remaining,excluded.remaining)", this.day(), value);
  }
}
