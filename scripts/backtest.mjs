import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMany } from './fetch-yahoo.mjs';
import { simulate } from './lib/backtest-engine.mjs';
import { bucketize } from './lib/backtest-aggregate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '../src/data/backtest.json');
const SIM_START = '2022-01-01';

function todayStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function loadJson(name) {
  return JSON.parse(readFileSync(resolve(__dirname, name), 'utf8'));
}

function simDayCountsFrom(tickers, simStart, simEnd) {
  const allDates = new Set();
  const byMarket = { KR: new Set(), US: new Set() };
  const byYear = {};
  for (const t of tickers) {
    for (const d of t.dates) {
      if (d < simStart || d > simEnd) continue;
      allDates.add(d);
      byMarket[t.market]?.add(d);
      const y = d.slice(0, 4);
      byYear[y] ??= new Set();
      byYear[y].add(d);
    }
  }
  return {
    overall: allDates.size,
    byMarket: { KR: byMarket.KR.size, US: byMarket.US.size },
    byYear: Object.fromEntries(Object.entries(byYear).map(([k, v]) => [k, v.size])),
  };
}

async function main() {
  const kr = loadJson('universe-kr.json');
  const us = loadJson('universe-us.json');
  const today = todayStr();

  console.log(`[backtest] fetching ${kr.length + us.length} tickers @ range=5y...`);
  const krFetched = await fetchMany(kr.map((t) => ({ ...t, market: 'KR' })), { range: '5y', delayMs: 200 });
  const usFetched = await fetchMany(us.map((t) => ({ ...t, market: 'US' })), { range: '5y', delayMs: 200 });

  const tickers = [...krFetched, ...usFetched]
    .filter((row) => row.data && row.data.dates && row.data.dates.length >= 30)
    .map((row) => ({
      ticker: row.ticker,
      name: row.name,
      market: row.market,
      dates: row.data.dates,
      closes: row.data.closes,
      volumes: row.data.volumes,
      highs: row.data.highs,
      lows: row.data.lows,
    }));

  console.log(`[backtest] usable tickers: ${tickers.length} (KR ${tickers.filter((t) => t.market === 'KR').length}, US ${tickers.filter((t) => t.market === 'US').length})`);

  console.log(`[backtest] simulating ${SIM_START} -> ${today}...`);
  const t0 = Date.now();
  const entries = simulate({ tickers, simStart: SIM_START, simEnd: today, today });
  console.log(`[backtest] entries: ${entries.length} (matured ${entries.filter((e) => e.status === 'matured').length}, active ${entries.filter((e) => e.status === 'active').length}) in ${Date.now() - t0}ms`);

  const simDayCounts = simDayCountsFrom(tickers, SIM_START, today);
  const buckets = bucketize(entries, simDayCounts);

  const out = {
    asOf: new Date().toISOString(),
    window: { start: SIM_START, end: today },
    simDays: simDayCounts.overall,
    simDayCounts,
    ...buckets,
    picks: entries.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'matured' ? -1 : 1;
      if (a.status === 'matured') return (b.return ?? 0) - (a.return ?? 0);
      return a.buyDate < b.buyDate ? 1 : -1;
    }),
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[backtest] wrote ${OUTPUT}`);
}

main().catch((err) => {
  console.error('[backtest] failed:', err);
  process.exit(1);
});
