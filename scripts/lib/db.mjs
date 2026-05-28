import { createClient } from '@libsql/client';
import { config } from 'dotenv';
config({ path: '.env.local' });

let cached;
export function getDb() {
  if (cached) return cached;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL not set');
  cached = createClient({ url, authToken });
  return cached;
}
