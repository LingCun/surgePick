import { readFileSync } from 'node:fs';
import { getDb } from './lib/db.mjs';
import { stdev } from './lib/stats.mjs';

const regime = JSON.parse(readFileSync(new URL('../src/data/regime.json', import.meta.url), 'utf8'));
const date = regime.asOf.slice(0, 10);   // 'YYYY-MM-DD'
const vix = regime.fearGauge?.vix ?? null;

function vixBand({ vix, vol20 }) {
  if (vix != null) {
    if (vix < 15) return 'low';
    if (vix < 25) return 'mid';
    return 'high';
  }
  if (vol20 == null) return null;
  if (vol20 < 0.15) return 'low';
  if (vol20 < 0.30) return 'mid';
  return 'high';
}

function labelFromScore(score) {
  if (score >= 2) return 'bull';
  if (score <= -2) return 'bear';
  return 'neutral';
}

function computeVol20(closes60) {
  if (!closes60 || closes60.length < 21) return null;
  const last20 = closes60.slice(-21);
  const rets = [];
  for (let i = 1; i < last20.length; i++) rets.push((last20[i] - last20[i - 1]) / last20[i - 1]);
  return stdev(rets) * Math.sqrt(252);
}

const db = getDb();
const stmts = [];

for (const m of regime.markets ?? []) {
  // KOSPI/KOSDAQ → KR, SP500/NASDAQ → US
  const marketCode = ['KOSPI', 'KOSDAQ'].includes(m.code) ? 'KR' : 'US';
  const vol20 = computeVol20(m.closes60);
  const vixForMarket = marketCode === 'US' ? vix : null;
  const band = vixBand({ vix: vixForMarket, vol20 });
  const label = labelFromScore(m.score);
  stmts.push({
    sql: `INSERT OR REPLACE INTO regime (date, market, label, vix, vix_band) VALUES (?, ?, ?, ?, ?)`,
    args: [date, marketCode, label, vixForMarket, band],
  });
}

// KOSPI/KOSDAQ 둘 다 KR이라 같은 row 가 두 번 INSERT 되므로 마지막 것만 남음.
// 대표값으로 첫 항목(KOSPI / SP500)만 사용하도록 dedupe:
const seen = new Set();
const dedup = stmts.filter((s) => {
  const key = `${s.args[0]}::${s.args[1]}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

await db.batch(dedup, 'write');
console.log(`✓ regime ingested for ${date}: ${dedup.length} markets`);
