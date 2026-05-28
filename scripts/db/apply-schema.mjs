import { readFileSync } from 'node:fs';
import { getDb } from '../lib/db.mjs';

const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const db = getDb();

const statements = sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
for (const stmt of statements) {
  console.log('>>', stmt.split('\n')[0]);
  await db.execute(stmt);
}
console.log(`✓ ${statements.length} statements applied`);
