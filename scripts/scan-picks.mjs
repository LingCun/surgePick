import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMany, fetchChart } from './fetch-yahoo.mjs';
import { scorePicks } from './lib/scoring.mjs';
import { pickReason } from './lib/reason-template.mjs';
import { classifyHorizon } from './lib/horizon.mjs';
import {
  loadHistory,
  saveHistory,
  todayDate,
  hasPickToday,
  makeEntry,
  updateEntry,
} from './lib/history-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function load(name) {
  return JSON.parse(readFileSync(resolve(__dirname, name), 'utf8'));
}

function dailyReturn(closes) {
  if (closes.length < 22) return 0;
  return closes[closes.length - 1] / closes[closes.length - 22] - 1;
}

function vol20(closes) {
  if (closes.length < 21) return 0.2;
  const rets = [];
  for (let i = closes.length - 20; i < closes.length; i++) {
    if (i <= 0) continue;
    rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

async function scanGroup(universe, marketLabel) {
  console.log(`[scan-picks] ${marketLabel} fetching ${universe.length} tickers...`);
  const fetched = await fetchMany(universe, { range: '4mo', delayMs: 200 });
  const candidates = [];

  for (const row of fetched) {
    if (!row.data || row.data.closes.length < 30) continue;
    try {
      const s = scorePicks(row.data);
      if (!s.passes.trendUp || !s.passes.volumeUp || !s.passes.accumulation) continue;

      const mom1m = dailyReturn(row.data.closes);
      const v20 = vol20(row.data.closes);
      const { horizon, holdDays } = classifyHorizon({
        scores: s.scores,
        metrics: s.metrics,
        mom1m,
        vol20: v20,
      });

      candidates.push({
        ticker: row.ticker,
        name: row.name,
        market: row.market,
        score: Math.round(s.total * 100),
        horizon,
        holdDays,
        mom1m,
        vol20: v20,
        scores: s.scores,
        metrics: s.metrics,
        closes30: row.data.closes.slice(-30),
        reason: pickReason({ scores: s.scores, metrics: s.metrics }),
        buyPrice: row.data.closes[row.data.closes.length - 1],
      });
    } catch (e) {
      console.warn(`[scan-picks] score failed for ${row.ticker}: ${e.message}`);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  console.log(`[scan-picks] ${marketLabel} candidates ${candidates.length}, top: ${candidates[0]?.ticker ?? 'none'}`);
  return candidates[0] ?? null;
}

async function refreshHoldings(history, today, vix) {
  const active = history.filter((e) => e.status === 'holding');
  if (active.length === 0) return history;

  console.log(`[scan-picks] refreshing ${active.length} active holdings...`);
  const updates = new Map();
  for (const entry of active) {
    const data = await fetchChart(entry.ticker, '1mo');
    if (!data || data.closes.length === 0) continue;
    const currentPrice = data.closes[data.closes.length - 1];
    updates.set(entry.id, updateEntry(entry, currentPrice, today, vix));
    await new Promise((r) => setTimeout(r, 200));
  }

  return history.map((e) => updates.get(e.id) ?? e);
}

async function runTrack({ label, krUniverseFile, usUniverseFile, outputPath, historyPath, idPrefix = '' }) {
  const kr = load(krUniverseFile);
  const us = load(usUniverseFile);
  const today = todayDate();

  const vixData = await fetchChart('^VIX', '1mo');
  const vix = vixData?.closes?.[vixData.closes.length - 1] ?? null;
  console.log(`[scan-picks/${label}] VIX today: ${vix?.toFixed(2) ?? 'N/A'}`);

  let history = loadHistory(historyPath);
  history = await refreshHoldings(history, today, vix);

  let krPick = null;
  let usPick = null;
  if (vix != null && vix > 20) {
    krPick = await scanGroup(kr, 'KR');
    usPick = await scanGroup(us, 'US');
  } else {
    console.log(`[scan-picks/${label}] VIX gate closed (need >20, got ${vix?.toFixed(2) ?? 'null'}) — no new entries today`);
  }

  const newEntries = [];
  if (krPick && !hasPickToday(history, 'KR', today)) {
    newEntries.push(makeEntry({ market: 'KR', buyDate: today, pick: krPick, idPrefix, vixAtBuy: vix }));
  }
  if (usPick && !hasPickToday(history, 'US', today)) {
    newEntries.push(makeEntry({ market: 'US', buyDate: today, pick: usPick, idPrefix, vixAtBuy: vix }));
  }
  history = [...history, ...newEntries];
  saveHistory(historyPath, history);
  console.log(`[scan-picks/${label}] history now has ${history.length} entries (added ${newEntries.length})`);

  // Today's picks snapshot for home page (1+1)
  const buildSnapshot = (entry) => {
    if (!entry) return null;
    return {
      id: entry.id,
      ticker: entry.ticker,
      name: entry.name,
      market: entry.market,
      score: entry.score,
      horizon: entry.horizon,
      holdDays: entry.holdDays,
      closes30: entry.closes30AtEntry,
      reason: entry.reason,
    };
  };

  const todayKR = history.find((e) => e.market === 'KR' && e.buyDate === today) ?? null;
  const todayUS = history.find((e) => e.market === 'US' && e.buyDate === today) ?? null;

  const out = {
    asOf: new Date().toISOString(),
    kr: buildSnapshot(todayKR),
    us: buildSnapshot(todayUS),
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[scan-picks/${label}] wrote ${outputPath}`);
}

async function main() {
  await runTrack({
    label: 'stocks',
    krUniverseFile: 'universe-kr.json',
    usUniverseFile: 'universe-us.json',
    outputPath: resolve(__dirname, '../src/data/picks.json'),
    historyPath: resolve(__dirname, '../src/data/picks-history.json'),
  });
  await runTrack({
    label: 'etfs',
    krUniverseFile: 'universe-etf-kr.json',
    usUniverseFile: 'universe-etf-us.json',
    outputPath: resolve(__dirname, '../src/data/picks-etf.json'),
    historyPath: resolve(__dirname, '../src/data/picks-history-etf.json'),
    idPrefix: 'etf-',
  });
}

main().catch((err) => {
  console.error('[scan-picks] failed:', err);
  process.exit(1);
});
