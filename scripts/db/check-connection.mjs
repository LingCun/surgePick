import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' });

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) { console.error('FAIL: TURSO_DATABASE_URL missing'); process.exit(1); }
if (!authToken) { console.error('FAIL: TURSO_AUTH_TOKEN missing'); process.exit(1); }

const client = createClient({ url, authToken });
try {
  const r = await client.execute("SELECT 1 AS ok");
  if (r.rows[0]?.ok === 1) console.log('OK: connection works');
  else { console.error('FAIL: unexpected result', r); process.exit(1); }
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
}
