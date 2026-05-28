import { createClient } from '@libsql/client';

let cached;
export function getDb() {
  if (cached) return cached;
  // Vercel serverless 런타임은 env 를 process.env 로 주입한다. import.meta.env 는
  // 빌드시 인라인된 값만 담고 비공개 secret 은 런타임에 비어 있을 수 있어 500 의 원인이 됨.
  // process.env 를 우선 사용하고 import.meta.env 로 폴백.
  const env = (typeof process !== 'undefined' && process.env) || {};
  const url = env.TURSO_DATABASE_URL ?? import.meta.env.TURSO_DATABASE_URL;
  const authToken = env.TURSO_AUTH_TOKEN ?? import.meta.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL not set in Astro env');
  cached = createClient({ url, authToken });
  return cached;
}
