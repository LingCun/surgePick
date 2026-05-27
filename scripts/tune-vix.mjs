import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMany, fetchChart } from './fetch-yahoo.mjs';
import { simulate } from './lib/backtest-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIM_START = '2022-01-01';

const ENTRY_VALUES = [16, 18, 20, 22, 24];
const EXIT_VALUES = [10, 12, 14, 15];

function todayStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function loadJson(name) {
  return JSON.parse(readFileSync(resolve(__dirname, name), 'utf8'));
}

async function loadUniverse(krFile, usFile) {
  const kr = loadJson(krFile);
  const us = loadJson(usFile);
  const krFetched = await fetchMany(kr.map((t) => ({ ...t, market: 'KR' })), { range: '5y', delayMs: 200 });
  const usFetched = await fetchMany(us.map((t) => ({ ...t, market: 'US' })), { range: '5y', delayMs: 200 });
  return [...krFetched, ...usFetched]
    .filter((row) => row.data && row.data.dates && row.data.dates.length >= 30)
    .map((row) => ({
      ticker: row.ticker, name: row.name, market: row.market,
      dates: row.data.dates, closes: row.data.closes,
      volumes: row.data.volumes, highs: row.data.highs, lows: row.data.lows,
    }));
}

function meanStddev(xs) {
  if (xs.length === 0) return { mean: 0, stddev: 0 };
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1);
  return { mean: m, stddev: Math.sqrt(v) };
}

function byYearMean(picks) {
  const buckets = {};
  for (const p of picks) {
    if (p.status !== 'matured') continue;
    const y = p.buyDate.slice(0, 4);
    (buckets[y] ??= []).push(p.return);
  }
  const out = {};
  for (const y of Object.keys(buckets).sort()) {
    const { mean } = meanStddev(buckets[y]);
    out[y] = { count: buckets[y].length, mean };
  }
  return out;
}

function evalCombo(stockTickers, etfTickers, vixByDate, today, vixEntry, vixExit) {
  const stocks = simulate({ tickers: stockTickers, simStart: SIM_START, simEnd: today, today, vixByDate, vixEntry, vixExit });
  const etfs = simulate({ tickers: etfTickers, simStart: SIM_START, simEnd: today, today, vixByDate, vixEntry, vixExit });
  const matured = [...stocks, ...etfs].filter((e) => e.status === 'matured');
  const rets = matured.map((e) => e.return);
  const { mean, stddev } = meanStddev(rets);
  const count = matured.length;
  const sharpe = stddev > 0 ? mean / stddev : 0;
  const penalty = count < 30 ? 0.5 : 1.0;
  const score = sharpe * penalty;
  const vixCount = matured.filter((e) => e.sellReason === 'vix').length;
  return { vixEntry, vixExit, count, mean, stddev, sharpe, score, vixCount, byYear: byYearMean(matured) };
}

function fmtPct(v) { return (v * 100).toFixed(2) + '%'; }
function fmt(v, d = 3) { return v.toFixed(d); }

async function main() {
  console.log('[tune-vix] fetching ^VIX 5y...');
  const vixData = await fetchChart('^VIX', '5y');
  if (!vixData) { console.error('VIX fetch failed'); process.exit(1); }
  const vixByDate = {};
  for (let i = 0; i < vixData.dates.length; i++) vixByDate[vixData.dates[i]] = vixData.closes[i];
  console.log(`[tune-vix] VIX days: ${Object.keys(vixByDate).length}`);

  console.log('[tune-vix] fetching universes...');
  const stockTickers = await loadUniverse('universe-kr.json', 'universe-us.json');
  const etfTickers = await loadUniverse('universe-etf-kr.json', 'universe-etf-us.json');
  console.log(`[tune-vix] tickers: ${stockTickers.length} stocks, ${etfTickers.length} etfs`);

  const today = todayStr();
  const results = [];
  for (const e of ENTRY_VALUES) {
    for (const x of EXIT_VALUES) {
      console.log(`[tune-vix] entry=${e} exit=${x}...`);
      results.push(evalCombo(stockTickers, etfTickers, vixByDate, today, e, x));
    }
  }
  results.sort((a, b) => (b.score - a.score) || (b.mean - a.mean));

  console.log('\n== Full ranking (sorted by score desc) ==');
  console.log('entry  exit  count  mean       stddev   sharpe   score    vixExits');
  for (const r of results) {
    console.log(
      `${String(r.vixEntry).padStart(5)}  ${String(r.vixExit).padStart(4)}  ` +
      `${String(r.count).padStart(5)}  ${fmtPct(r.mean).padStart(9)}  ${fmt(r.stddev).padStart(6)}  ` +
      `${fmt(r.sharpe).padStart(7)}  ${fmt(r.score).padStart(7)}  ${String(r.vixCount).padStart(4)}`
    );
  }

  console.log('\n== Top 3 (with byYear) ==');
  for (let i = 0; i < Math.min(3, results.length); i++) {
    const r = results[i];
    console.log(`\n#${i+1}: entry=${r.vixEntry}, exit=${r.vixExit}`);
    console.log(`  count=${r.count}, mean=${fmtPct(r.mean)}, stddev=${fmt(r.stddev)}, sharpe=${fmt(r.sharpe)}, score=${fmt(r.score)}`);
    for (const [y, b] of Object.entries(r.byYear)) {
      console.log(`  ${y}: n=${b.count} mean=${fmtPct(b.mean)}`);
    }
  }
}

main().catch((err) => { console.error('[tune-vix] failed:', err); process.exit(1); });
