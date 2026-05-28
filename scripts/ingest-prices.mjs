import { fetchChart } from './fetch-yahoo.mjs';
import { getDb } from './lib/db.mjs';

const db = getDb();
const tickers = await db.execute(`SELECT ticker FROM tickers WHERE active = 1`);
const list = tickers.rows.map((r) => r.ticker);

console.log(`incremental ingest: ${list.length} tickers (1mo, dedup)`);

let ok = 0, fail = 0, inserted = 0;
for (let i = 0; i < list.length; i++) {
  const t = list[i];
  const data = await fetchChart(t, '1mo');
  if (!data || !data.dates?.length) {
    fail++;
    await sleep(200);
    continue;
  }
  const stmts = data.dates.map((d, j) => ({
    sql: `INSERT OR IGNORE INTO prices (ticker, date, open, close, high, low) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [t, d, data.opens[j], data.closes[j], data.highs[j], data.lows[j]],
  }));
  const res = await db.batch(stmts, 'write');
  const newRows = res.reduce((acc, r) => acc + (r.rowsAffected ?? 0), 0);
  inserted += newRows;
  ok++;
  await sleep(150);
}
console.log(`done. ok=${ok} fail=${fail} new_rows=${inserted}`);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
