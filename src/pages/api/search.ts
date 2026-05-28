import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db.mjs';
import { search } from '../../lib/autocomplete.mjs';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q') ?? '';
  if (!q.trim()) return new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } });

  const db = getDb();
  const res = await db.execute(`SELECT ticker, name_kr, name_en, market, exchange FROM tickers WHERE active = 1`);
  const matches = search(res.rows, q, 20);
  return new Response(JSON.stringify(matches), { headers: { 'content-type': 'application/json' } });
};
