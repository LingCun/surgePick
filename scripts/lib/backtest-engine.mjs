import { valuationTag } from './valuation.mjs';
import { createDcaPlan, createDistPlan, chunkDueOn, abortIfSignalChanged } from './dca-plan.mjs';
import { evaluateExit } from './exit-rules.mjs';
import {
  initState, buyShares, sellShares, computeEquity, freeSlots,
  updatePeak, setPlan, blacklistTicker, isBlacklisted,
} from './portfolio.mjs';
import { scorePicks } from './scoring.mjs';

const FX_USD_KRW = 1300;
const MAX_SLOTS = 5;
const MIN_POSITION_FRACTION = 0.05;
const BLACKLIST_DAYS = 30;

function addCalendarDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function buildSimDates(tickers, simStart, simEnd) {
  const set = new Set();
  for (const t of tickers) for (const d of t.dates) if (d >= simStart && d <= simEnd) set.add(d);
  return [...set].sort();
}

function priceMapAt(tickers, date) {
  const map = {};
  for (const t of tickers) {
    const idx = t.dates.indexOf(date);
    if (idx >= 0) map[t.ticker] = t.closes[idx];
    else {
      // last available close on or before date
      let last = null;
      for (let k = t.dates.length - 1; k >= 0; k--) {
        if (t.dates[k] <= date) { last = t.closes[k]; break; }
      }
      if (last != null) map[t.ticker] = last;
    }
  }
  return map;
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86_400_000);
}

function convictionMultiplier(slice, distancePctBelowMa) {
  let mult = 1.0;
  try {
    const s = scorePicks(slice);
    if (s.passes.trendUp && s.passes.volumeUp && s.passes.accumulation) mult *= 1.5;
  } catch { /* not enough data */ }
  if (distancePctBelowMa > 0.05) mult *= 1.3;
  return Math.max(0.7, Math.min(1.5, mult));
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

/**
 * Run the CWC portfolio simulation.
 * Inputs:
 *   tickers[]      { ticker, name, market, dates[], closes[], volumes[], highs[], lows[] }
 *   simStart, simEnd, today
 *   initialCapital { krInitial, usInitial }
 *   indexByMarket  { KR: {dates,closes}, US: {dates,closes} } (currently unused but reserved for RS)
 *   bearByMarket   { KR: {date→bool}, US: {date→bool} }
 * Returns { equityCurve[], ledger[], positions[], finalState }
 */
export function simulate({
  tickers, simStart, simEnd, today,
  initialCapital, indexByMarket = {}, bearByMarket = {},
}) {
  let state = initState({
    krInitial: initialCapital.krInitial,
    usInitial: initialCapital.usInitial,
    maxSlots: MAX_SLOTS,
  });
  const ledger = [];
  const equityCurve = [];
  const tickersByKey = new Map(tickers.map((t) => [t.ticker, t]));
  const simDates = buildSimDates(tickers, simStart, simEnd);

  for (const D of simDates) {
    if (D > today) break;
    const prices = priceMapAt(tickers, D);

    // 1. Update peaks for all open positions
    for (const market of ['KR', 'US']) {
      const pool = market === 'KR' ? state.kr : state.us;
      for (const p of pool.positions) {
        const px = prices[p.ticker];
        if (px != null) state = updatePeak(state, market, p.ticker, px);
      }
    }

    // 2. Risk gates — evaluate every open position
    for (const market of ['KR', 'US']) {
      const isBear = bearByMarket[market]?.[D] === true;
      const pool = market === 'KR' ? state.kr : state.us;
      const positionsSnapshot = [...pool.positions];
      for (const p of positionsSnapshot) {
        const px = prices[p.ticker];
        if (px == null) continue;
        const holdingDays = daysBetween(p.firstBuyDate, D);
        const verdict = evaluateExit({
          close: px, avgCost: p.avgCost, peak: p.peak,
          isBear, holdingDays,
        });
        if (!verdict.fire) continue;
        const sharesSold = p.shares;
        state = sellShares(state, { market, ticker: p.ticker, shares: sharesSold, price: px });
        ledger.push({
          date: D, action: 'sell', market, ticker: p.ticker, name: p.name,
          shares: sharesSold, price: px, reason: verdict.reason,
          unrealizedReturn: (px - p.avgCost) / p.avgCost,
        });
        if (verdict.reason === 'catastrophe' || verdict.reason === 'trailing') {
          state = blacklistTicker(state, market, p.ticker, addCalendarDays(D, BLACKLIST_DAYS));
        }
      }
    }

    // 3. Distribution fills (active dist plans)
    for (const market of ['KR', 'US']) {
      const pool = market === 'KR' ? state.kr : state.us;
      for (const p of [...pool.positions]) {
        if (!p.distPlan) continue;
        const t = tickersByKey.get(p.ticker);
        if (!t) continue;
        const idx = t.dates.indexOf(D);
        if (idx < 0) continue;
        const tag = valuationTag(t.closes.slice(0, idx + 1));
        if (abortIfSignalChanged(p.distPlan, tag)) {
          state = setPlan(state, market, p.ticker, 'distPlan', null);
          continue;
        }
        const chunk = chunkDueOn(p.distPlan, D);
        if (!chunk) continue;
        const px = t.closes[idx];
        const sharesToSell = Math.min(chunk.shares, p.shares);
        if (sharesToSell <= 0) continue;
        state = sellShares(state, { market, ticker: p.ticker, shares: sharesToSell, price: px });
        chunk.filled = true;
        ledger.push({
          date: D, action: 'sell', market, ticker: p.ticker, name: p.name,
          shares: sharesToSell, price: px, reason: 'dist-chunk',
        });
      }
    }

    // 4. DCA fills (existing pending DCA plans + new entries)
    for (const market of ['KR', 'US']) {
      const pool = market === 'KR' ? state.kr : state.us;
      for (const p of [...pool.positions]) {
        if (!p.dcaPlan) continue;
        const t = tickersByKey.get(p.ticker);
        if (!t) continue;
        const idx = t.dates.indexOf(D);
        if (idx < 0) continue;
        const tag = valuationTag(t.closes.slice(0, idx + 1));
        if (abortIfSignalChanged(p.dcaPlan, tag)) {
          state = setPlan(state, market, p.ticker, 'dcaPlan', null);
          continue;
        }
        const chunk = chunkDueOn(p.dcaPlan, D);
        if (!chunk) continue;
        const px = t.closes[idx];
        const cost = chunk.shares * px;
        if (pool.cash < cost) continue;
        state = buyShares(state, { market, ticker: p.ticker, name: p.name, shares: chunk.shares, price: px, date: D });
        chunk.filled = true;
        ledger.push({
          date: D, action: 'buy', market, ticker: p.ticker, name: p.name,
          shares: chunk.shares, price: px, reason: 'dca-chunk',
        });
      }
    }

    // 5. New entries — scan watchlist for CHEAP signals
    for (const t of tickers) {
      const market = t.market;
      if (bearByMarket[market]?.[D] === true) continue;
      const idx = t.dates.indexOf(D);
      if (idx < 0) continue;
      if (idx < 200) continue;
      const slice = t.closes.slice(0, idx + 1);
      const tag = valuationTag(slice);
      if (tag !== 'cheap') continue;
      if (isBlacklisted(state, market, t.ticker, D)) continue;
      const pool = market === 'KR' ? state.kr : state.us;
      if (pool.positions.some((p) => p.ticker === t.ticker)) continue;
      if (freeSlots(state, market) === 0) continue;

      const eq = computeEquity(state, prices, { usdKrw: FX_USD_KRW });
      const marketEquity = market === 'KR'
        ? eq.kr.cash + eq.kr.posValue
        : eq.us.cash + eq.us.posValue;
      const baseSize = marketEquity / MAX_SLOTS;
      const ma200 = slice.slice(-200).reduce((a, b) => a + b, 0) / 200;
      const price = t.closes[idx];
      const distancePctBelowMa = ma200 > price ? (ma200 - price) / ma200 : 0;
      const sliceForScoring = {
        closes: t.closes.slice(Math.max(0, idx - 29), idx + 1),
        volumes: t.volumes.slice(Math.max(0, idx - 29), idx + 1),
        highs: t.highs.slice(Math.max(0, idx - 29), idx + 1),
        lows: t.lows.slice(Math.max(0, idx - 29), idx + 1),
      };
      const conviction = convictionMultiplier(sliceForScoring, distancePctBelowMa);
      const v20 = vol20(slice);
      const volAdjust = v20 > 0.35 ? 0.7 : 1.0;
      const targetSize = baseSize * conviction * volAdjust;
      if (targetSize < marketEquity * MIN_POSITION_FRACTION) continue;
      const totalShares = Math.floor(targetSize / price);
      if (totalShares < 3) continue;

      const dcaPlan = createDcaPlan({ startDate: D, totalShares });
      const day1Chunk = dcaPlan.chunks[0];
      const day1Cost = day1Chunk.shares * price;
      if (pool.cash < day1Cost) continue;

      state = buyShares(state, { market, ticker: t.ticker, name: t.name, shares: day1Chunk.shares, price, date: D });
      day1Chunk.filled = true;
      state = setPlan(state, market, t.ticker, 'dcaPlan', dcaPlan);
      ledger.push({
        date: D, action: 'buy', market, ticker: t.ticker, name: t.name,
        shares: day1Chunk.shares, price, reason: 'dca-start',
        conviction, volAdjust,
      });
    }

    // 6. Check for rich signals on open positions — start dist plan
    for (const market of ['KR', 'US']) {
      const pool = market === 'KR' ? state.kr : state.us;
      for (const p of [...pool.positions]) {
        if (p.distPlan) continue;
        const t = tickersByKey.get(p.ticker);
        if (!t) continue;
        const idx = t.dates.indexOf(D);
        if (idx < 0) continue;
        const slice = t.closes.slice(0, idx + 1);
        const tag = valuationTag(slice);
        if (tag !== 'rich') continue;
        const px = t.closes[idx];
        const gain = (px - p.avgCost) / p.avgCost;
        if (gain < 0.20) continue;  // tuning F: start distribution at +20% (was +10%) — let winners run
        const plan = createDistPlan({ startDate: D, totalShares: p.shares });
        state = setPlan(state, market, p.ticker, 'distPlan', plan);
      }
    }

    // 7. Record equity curve point
    const eqPoint = computeEquity(state, prices, { usdKrw: FX_USD_KRW });
    equityCurve.push({
      date: D,
      total: eqPoint.totalKrwEquiv,
      krCash: eqPoint.kr.cash, krPos: eqPoint.kr.posValue,
      usCash: eqPoint.us.cash, usPos: eqPoint.us.posValue,
    });
  }

  // Final position snapshot
  const finalPrices = priceMapAt(tickers, simDates[simDates.length - 1] ?? today);
  const positions = [];
  for (const market of ['KR', 'US']) {
    const pool = market === 'KR' ? state.kr : state.us;
    for (const p of pool.positions) {
      const px = finalPrices[p.ticker] ?? p.avgCost;
      positions.push({
        market,
        ticker: p.ticker, name: p.name,
        shares: p.shares, avgCost: p.avgCost, peak: p.peak,
        currentPrice: px,
        unrealizedReturn: (px - p.avgCost) / p.avgCost,
        firstBuyDate: p.firstBuyDate, lastBuyDate: p.lastBuyDate,
        dcaPlan: p.dcaPlan, distPlan: p.distPlan,
      });
    }
  }

  return { equityCurve, ledger, positions, finalState: state };
}
