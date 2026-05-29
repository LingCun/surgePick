import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChart } from './fetch-yahoo.mjs';
import { scoreRegime, labelFromScore } from './lib/regime.mjs';
import { fearGauge } from './lib/fear-gauge.mjs';
import { marketComment, overallComment } from './lib/market-comment.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '../src/data/regime.json');

// MARKET env: 'kr' / 'us' / 'all' (default). 부분 갱신 모드에서는 미해당 region 의 이전 데이터를 보존.
const MARKET = (process.env.MARKET ?? 'all').toLowerCase();

const ALL_INDICES = [
  { code: 'KOSPI',  index: '^KS11',  emoji: '🇰🇷', region: 'KR' },
  { code: 'KOSDAQ', index: '^KQ11',  emoji: '🇰🇷', region: 'KR' },
  { code: 'SP500',  index: '^GSPC',  emoji: '🇺🇸', region: 'US' },
  { code: 'NASDAQ', index: '^IXIC',  emoji: '🇺🇸', region: 'US' },
];
const INDICES = MARKET === 'kr' ? ALL_INDICES.filter((i) => i.region === 'KR')
  : MARKET === 'us' ? ALL_INDICES.filter((i) => i.region === 'US')
  : ALL_INDICES;

async function main() {
  console.log('[scan-regime] fetching indices + VIX...');

  const vixData = await fetchChart('^VIX', '1mo');
  const vix = vixData?.closes?.[vixData.closes.length - 1] ?? null;

  const markets = [];
  for (const idx of INDICES) {
    const data = await fetchChart(idx.index, '1y');
    if (!data || data.closes.length < 64) {
      console.warn(`[scan-regime] insufficient data for ${idx.index}`);
      continue;
    }
    const r = scoreRegime({ closes: data.closes, vix: idx.region === 'US' ? vix : null, market: idx.region });
    const { label, weight } = labelFromScore(r.score);

    const closes = data.closes;
    const last60 = closes.slice(-60);
    const startIdx = closes.length - 60;
    const ma50 = last60.map((_, i) => {
      const g = startIdx + i;
      if (g < 49) return null;
      const w = closes.slice(g - 49, g + 1);
      return w.reduce((a, b) => a + b, 0) / 50;
    });
    const ma200 = last60.map((_, i) => {
      const g = startIdx + i;
      if (g < 199) return null;
      const w = closes.slice(g - 199, g + 1);
      return w.reduce((a, b) => a + b, 0) / 200;
    });

    markets.push({
      code: idx.code,
      emoji: idx.emoji,
      label,
      weight,
      score: r.score,
      comment: marketComment(label),
      closes60: last60,
      ma50,
      ma200,
      _debug: r.metrics,
    });
  }

  const gauge = vix != null
    ? fearGauge(vix)
    : { vix: null, level: '데이터 없음', step: 3, color: 'neutral', comment: '' };

  const now = new Date().toISOString();

  // 부분 갱신: 기존 regime.json 의 미해당 region markets 와 timestamps 를 보존.
  let prev = {};
  if (existsSync(OUTPUT)) {
    try { prev = JSON.parse(readFileSync(OUTPUT, 'utf8')); } catch {}
  }
  const prevMarkets = Array.isArray(prev.markets) ? prev.markets : [];
  let mergedMarkets;
  let asOfKR = prev.asOfKR ?? null;
  let asOfUS = prev.asOfUS ?? null;

  if (MARKET === 'kr') {
    const us = prevMarkets.filter((m) => m.code === 'SP500' || m.code === 'NASDAQ');
    mergedMarkets = [...markets, ...us];
    asOfKR = now;
  } else if (MARKET === 'us') {
    const kr = prevMarkets.filter((m) => m.code === 'KOSPI' || m.code === 'KOSDAQ');
    mergedMarkets = [...kr, ...markets];
    asOfUS = now;
  } else {
    mergedMarkets = markets;
    asOfKR = now;
    asOfUS = now;
  }

  const overall = overallComment(mergedMarkets);

  const out = {
    asOf: now,
    asOfKR,
    asOfUS,
    fearGauge: gauge,
    markets: mergedMarkets,
    overall,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[scan-regime market=${MARKET}] wrote ${OUTPUT} — VIX ${vix?.toFixed(2)}, ${mergedMarkets.length} markets (KR asOf=${asOfKR ?? '-'}, US asOf=${asOfUS ?? '-'})`);
}

main().catch((err) => {
  console.error('[scan-regime] failed:', err);
  process.exit(1);
});
