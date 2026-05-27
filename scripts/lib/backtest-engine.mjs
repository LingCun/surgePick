import { scorePicks } from './scoring.mjs';
import { classifyHorizon } from './horizon.mjs';
import { pickReason } from './reason-template.mjs';

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

function addCalendarDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function firstIndexAtOrAfter(dates, target) {
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= target) return i;
  }
  return -1;
}

function resolveExit(tickerData, buyIndex, holdDays, today) {
  const buyDate = tickerData.dates[buyIndex];
  const matureDate = addCalendarDays(buyDate, holdDays);
  const exitIdx = firstIndexAtOrAfter(tickerData.dates, matureDate);
  if (exitIdx === -1 || tickerData.dates[exitIdx] > today) {
    return { exitDate: null, exitPrice: null, status: 'active' };
  }
  return {
    exitDate: tickerData.dates[exitIdx],
    exitPrice: tickerData.closes[exitIdx],
    status: 'matured',
  };
}

function buildSimDates(tickers, simStart, simEnd) {
  const set = new Set();
  for (const t of tickers) {
    for (const d of t.dates) {
      if (d >= simStart && d <= simEnd) set.add(d);
    }
  }
  return [...set].sort();
}

export function simulate({ tickers, simStart, simEnd, today }) {
  if (!today) {
    const d = new Date();
    today = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const entries = [];

  const byMarket = new Map();
  for (const t of tickers) {
    if (!byMarket.has(t.market)) byMarket.set(t.market, []);
    byMarket.get(t.market).push(t);
  }

  for (const [market, marketTickers] of byMarket) {
    const simDates = buildSimDates(marketTickers, simStart, simEnd);
    const activeUntil = new Map();

    for (const D of simDates) {
      for (const [tkr, mat] of activeUntil) {
        if (mat < D) activeUntil.delete(tkr);
      }

      const candidates = [];
      for (const t of marketTickers) {
        const idx = firstIndexAtOrAfter(t.dates, D);
        if (idx === -1 || t.dates[idx] !== D) continue;
        if (idx + 1 < 30) continue;
        const slice = {
          closes: t.closes.slice(0, idx + 1),
          volumes: t.volumes.slice(0, idx + 1),
          highs: t.highs.slice(0, idx + 1),
          lows: t.lows.slice(0, idx + 1),
        };
        let s;
        try {
          s = scorePicks(slice);
        } catch {
          continue;
        }
        if (!s.passes.trendUp || !s.passes.volumeUp || !s.passes.accumulation) continue;
        candidates.push({ ticker: t, idx, s });
      }
      if (candidates.length === 0) continue;

      candidates.sort((a, b) => b.s.total - a.s.total);
      const top = candidates[0];

      if (activeUntil.has(top.ticker.ticker)) continue;

      const closesSlice = top.ticker.closes.slice(0, top.idx + 1);
      const mom1m = dailyReturn(closesSlice);
      const v20 = vol20(closesSlice);
      const { horizon, holdDays } = classifyHorizon({
        scores: top.s.scores,
        metrics: top.s.metrics,
        mom1m,
        vol20: v20,
      });

      const buyDate = D;
      const buyPrice = top.ticker.closes[top.idx];
      const matureDate = addCalendarDays(buyDate, holdDays);
      activeUntil.set(top.ticker.ticker, matureDate);

      const exit = resolveExit(top.ticker, top.idx, holdDays, today);
      const ret = exit.exitPrice == null ? null : exit.exitPrice / buyPrice - 1;

      entries.push({
        id: `${market.toLowerCase()}-${buyDate}-${top.ticker.ticker.replace(/[.^]/g, '')}`,
        market,
        ticker: top.ticker.ticker,
        name: top.ticker.name,
        buyDate,
        buyPrice,
        exitDate: exit.exitDate,
        exitPrice: exit.exitPrice,
        return: ret,
        horizon,
        holdDays,
        score: Math.round(top.s.total * 100),
        reason: pickReason({ scores: top.s.scores, metrics: top.s.metrics }),
        status: exit.status,
      });
    }
  }

  return entries;
}
