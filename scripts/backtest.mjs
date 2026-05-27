import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMany, fetchChart } from './fetch-yahoo.mjs';
import { simulate } from './lib/backtest-engine.mjs';
import { bucketize } from './lib/backtest-aggregate.mjs';
import { buildBearMap } from './lib/regime-detect.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIM_START = '2022-01-01';
const DEFENSIVE_TICKERS = ['SQQQ', 'GLD', 'TLT', 'BND'];

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

async function runBacktestTrack({ label, krUniverseFile, usUniverseFile, outputPath, vixByDate, bearByMarket, defensiveTickers = [] }) {
  const kr = loadJson(krUniverseFile);
  const us = loadJson(usUniverseFile);
  const today = todayStr();

  console.log(`[backtest/${label}] fetching ${kr.length + us.length} tickers @ range=5y...`);
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

  console.log(`[backtest/${label}] usable tickers: ${tickers.length} (KR ${tickers.filter((t) => t.market === 'KR').length}, US ${tickers.filter((t) => t.market === 'US').length})`);

  console.log(`[backtest/${label}] simulating ${SIM_START} -> ${today}...`);
  const t0 = Date.now();
  const entries = simulate({ tickers, simStart: SIM_START, simEnd: today, today, vixByDate, bearByMarket, defensiveTickers });
  console.log(`[backtest/${label}] entries: ${entries.length} (matured ${entries.filter((e) => e.status === 'matured').length}, active ${entries.filter((e) => e.status === 'active').length}) in ${Date.now() - t0}ms`);

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

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[backtest/${label}] wrote ${outputPath}`);
}

async function main() {
  console.log('[backtest] fetching ^VIX, ^GSPC, ^KS11 (5y)...');
  const [vixData, gspcData, ksData] = await Promise.all([
    fetchChart('^VIX', '5y'),
    fetchChart('^GSPC', '5y'),
    fetchChart('^KS11', '5y'),
  ]);
  if (!gspcData || !ksData) {
    console.error('[backtest] failed to fetch indices — cannot run bear-gated backtest');
    process.exit(1);
  }
  const vixByDate = {};
  if (vixData) {
    for (let i = 0; i < vixData.dates.length; i++) {
      vixByDate[vixData.dates[i]] = vixData.closes[i];
    }
  }
  const bearByMarket = {
    US: buildBearMap(gspcData.dates, gspcData.closes),
    KR: buildBearMap(ksData.dates, ksData.closes),
  };
  const bearDaysUS = Object.values(bearByMarket.US).filter(Boolean).length;
  const bearDaysKR = Object.values(bearByMarket.KR).filter(Boolean).length;
  console.log(`[backtest] bear days — US: ${bearDaysUS}, KR: ${bearDaysKR}`);

  await runBacktestTrack({
    label: 'stocks',
    krUniverseFile: 'universe-kr.json',
    usUniverseFile: 'universe-us.json',
    outputPath: resolve(__dirname, '../src/data/backtest.json'),
    vixByDate,
    bearByMarket,
  });
  await runBacktestTrack({
    label: 'etfs',
    krUniverseFile: 'universe-etf-kr.json',
    usUniverseFile: 'universe-etf-us.json',
    outputPath: resolve(__dirname, '../src/data/backtest-etf.json'),
    vixByDate,
    bearByMarket,
    defensiveTickers: DEFENSIVE_TICKERS,
  });
}

main().catch((err) => {
  console.error('[backtest] failed:', err);
  process.exit(1);
});
