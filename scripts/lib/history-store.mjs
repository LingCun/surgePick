import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * File-based picks history store. Appends new picks, updates active holdings,
 * transitions matured entries to 'sold' (price/return frozen at maturity).
 */

const VIX_EXIT = 15;

export function loadHistory(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf8');
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveHistory(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

export function todayDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return todayDate(d);
}

/**
 * Has a pick already been recorded for this market on this date?
 * Used to keep scan idempotent (running twice same day = no duplicate).
 */
export function hasPickToday(history, market, date) {
  return history.some((e) => e.market === market && e.buyDate === date);
}

/**
 * Build new history entry from scanner pick.
 */
export function makeEntry({ market, pick, buyDate, idPrefix = '', vixAtBuy = null }) {
  return {
    id: `${idPrefix}${market.toLowerCase()}-${buyDate}-${pick.ticker.replace(/[.^]/g, '')}`,
    market,
    ticker: pick.ticker,
    name: pick.name,
    buyDate,
    buyPrice: pick.buyPrice,
    horizon: pick.horizon,
    holdDays: pick.holdDays,
    matureDate: addDays(buyDate, pick.holdDays),
    reason: pick.reason,
    score: pick.score,
    metricsAtEntry: pick.metrics,
    scoresAtEntry: pick.scores,
    closes30AtEntry: pick.closes30,
    currentPrice: pick.buyPrice,
    currentDate: buyDate,
    returnPct: 0,
    vixAtBuy,
    status: 'holding',
    sellDate: null,
    sellPrice: null,
    sellReason: null,
    vixAtSell: null,
  };
}

/**
 * Update one holding entry with today's price + status transition if matured.
 * Pure — returns new entry object.
 */
export function updateEntry(entry, currentPrice, today, vix = null) {
  if (entry.status === 'sold') return entry;

  const returnPct = entry.buyPrice
    ? ((currentPrice - entry.buyPrice) / entry.buyPrice) * 100
    : 0;

  let sellReason = null;
  if (vix != null && vix < VIX_EXIT) sellReason = 'vix';
  else if (today >= entry.matureDate) sellReason = 'matured';

  if (sellReason) {
    return {
      ...entry,
      currentPrice,
      currentDate: today,
      returnPct,
      status: 'sold',
      sellDate: today,
      sellPrice: currentPrice,
      sellReason,
      vixAtSell: vix,
    };
  }

  return {
    ...entry,
    currentPrice,
    currentDate: today,
    returnPct,
  };
}
