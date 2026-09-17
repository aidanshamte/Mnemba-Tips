import pg from 'pg';

// D1 exposes INTEGER and COUNT as JavaScript numbers. Refuse lossy conversion.
pg.types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('PostgreSQL integer exceeds safe JavaScript range');
  return number;
});

export function translateSQL(sql) {
  // Only the SQLite dialect used by this application is supported.
  let translated = sql.replace(/json_extract\(\s*([\w.]+)\s*,\s*'\$\.([\w.]+)'\s*\)/gi,
    (_, column, path) => `(${column}::jsonb #>> '{${path.split('.').join(',')}}')`);
  const ignore = /^\s*INSERT OR IGNORE\b/i.test(translated);
  let parameter = 0;
  translated = translated.split(/('(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\/)/g).map((part, index) => {
    if (index % 2) return part.startsWith('`') ? '"' + part.slice(1, -1) + '"' : part;
    return part.replace(/INSERT OR IGNORE/gi, 'INSERT')
      .replace(/\bINTEGER\b/gi, 'BIGINT')
      .replace(/\bREAL\b/gi, 'DOUBLE PRECISION')
      .replace(/\bLIKE\b/gi, 'ILIKE')
      .replace(/\browid\b/gi, '_sqlite_rowid')
      .replace(/\bMAX\(0,remaining-1\)/gi, 'GREATEST(0,remaining-1)')
      .replace(/\bMIN\(provider_limits.remaining,excluded.remaining\)/gi, 'LEAST(provider_limits.remaining,excluded.remaining)')
      .replace(/\b([a-z_]+[A-Z][a-zA-Z_]*)\b/g, '"$1"')
      .replace(/\?/g, () => '$' + (++parameter));
  }).join('');
  if (ignore) translated = translated.replace(/;\s*$/, '') + ' ON CONFLICT DO NOTHING';
  return translated;
}

export function postgresDatabase(pool) {
  async function execute(sql, args) {
    if (!/^\s*INSERT INTO api_request_usage\b/i.test(sql)) return pool.query(translateSQL(sql), args);
    // SQLite serializes writers; PostgreSQL needs an explicit cross-category budget lock.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(714026)');
      const result = await client.query(translateSQL(sql), args);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  const statement = (sql, args = []) => ({
    sql, args,
    bind(...values) { return statement(sql, values); },
    async all() { const result = await execute(sql, args); return { results: result.rows, success: true, meta: { changes: result.rowCount } }; },
    async first(column) { const row = (await this.all()).results[0] ?? null; return column ? row?.[column] ?? null : row; },
    async run() { return this.all(); },
    async raw() { return (await pool.query({ text: translateSQL(sql), values: args, rowMode: 'array' })).rows; },
  });
  return {
    prepare: sql => statement(sql),
    async batch(statements) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (statements.some(s => /^\s*INSERT INTO api_request_usage\b/i.test(s.sql))) await client.query('SELECT pg_advisory_xact_lock(714026)');
        const results = [];
        for (const s of statements) { const r = await client.query(translateSQL(s.sql), s.args); results.push({ results: r.rows, success: true, meta: { changes: r.rowCount } }); }
        await client.query('COMMIT'); return results;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  // TLS must verify the managed PostgreSQL server certificate.
  url.searchParams.delete('sslmode');
  const schema = process.env.MNEMBA_DATABASE_SCHEMA ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(schema)) throw new Error('Invalid database schema');
  return new pg.Pool({ options: '-c search_path=' + schema + ',public', connectionString: url.toString(), max: 5, connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000, statement_timeout: 60000, ssl: local ? false : { rejectUnauthorized: true } });
}
