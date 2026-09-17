import { createPool, postgresDatabase } from './postgres.mjs';
let database;
export const env = new Proxy({}, {
  get(_, key) {
    if (key === 'DB') return database ??= postgresDatabase(createPool());
    if (key === 'MNEMBA_SCHEMA_MANAGED') return '1';
    return process.env[key];
  },
});
