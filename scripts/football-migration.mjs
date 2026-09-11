import { writeFileSync } from 'node:fs';
import { migration } from '../lib/football/schema.mjs';
// Runtime and export share one source of truth. Existing D1 tables are not replaced.
writeFileSync(new URL('../drizzle/0001_global_football.sql',import.meta.url),migration.join(';\n\n')+';\n');
console.log('Exported additive football migration');
