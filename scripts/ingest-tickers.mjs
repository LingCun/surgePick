import { readFileSync } from 'node:fs';
import { getDb } from './lib/db.mjs';

const kr = JSON.parse(readFileSync(new URL('./universe-kr.json', import.meta.url), 'utf8'));
const us = JSON.parse(readFileSync(new URL('./universe-us.json', import.meta.url), 'utf8'));

const rows = [
  ...kr.map((t) => ({
    ticker: t.ticker,
    name_kr: t.name,
    name_en: null,
    market: 'KR',
    exchange: t.market,
  })),
  ...us.map((t) => ({
    ticker: t.ticker,
    name_kr: null,
    name_en: t.name,
    market: 'US',
    exchange: t.market,
  })),
];

const db = getDb();
let inserted = 0;
for (const r of rows) {
  await db.execute({
    sql: `INSERT OR REPLACE INTO tickers (ticker, name_kr, name_en, market, exchange, active)
          VALUES (?, ?, ?, ?, ?, 1)`,
    args: [r.ticker, r.name_kr, r.name_en, r.market, r.exchange],
  });
  inserted++;
}
console.log(`✓ ${inserted} tickers upserted`);
