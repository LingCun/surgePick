import { fetchChart } from './fetch-yahoo.mjs';
import { getDb } from './lib/db.mjs';

const db = getDb();
const tickers = await db.execute(`SELECT ticker FROM tickers WHERE active = 1`);
const list = tickers.rows.map((r) => r.ticker);

console.log(`backfilling ${list.length} tickers (5y)...`);

let ok = 0, fail = 0, totalRows = 0;
for (let i = 0; i < list.length; i++) {
  const t = list[i];
  const data = await fetchChart(t, '5y');
  if (!data || !data.dates?.length) {
    fail++;
    console.warn(`[${i + 1}/${list.length}] ${t}: no data`);
    await sleep(200);
    continue;
  }
  // 배치 트랜잭션으로 upsert (500 rows 단위)
  const stmts = [];
  for (let j = 0; j < data.dates.length; j++) {
    stmts.push({
      sql: `INSERT OR REPLACE INTO prices (ticker, date, open, close, high, low)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [t, data.dates[j], data.opens[j], data.closes[j], data.highs[j], data.lows[j]],
    });
  }
  // libsql batch는 최대 N개 statement 지원, 안전하게 500개씩
  for (let k = 0; k < stmts.length; k += 500) {
    await db.batch(stmts.slice(k, k + 500), 'write');
  }
  ok++;
  totalRows += data.dates.length;
  if ((i + 1) % 5 === 0) console.log(`[${i + 1}/${list.length}] ok=${ok} fail=${fail} rows=${totalRows}`);
  await sleep(200);
}
console.log(`done. ok=${ok} fail=${fail} total_rows=${totalRows}`);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
