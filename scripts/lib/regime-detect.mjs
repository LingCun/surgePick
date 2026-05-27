/**
 * Simple moving average of the last N values ending at index `endIdx` (inclusive).
 * Returns NaN if there aren't N values available.
 */
export function sma(closes, endIdx, window) {
  if (endIdx < window - 1) return NaN;
  let sum = 0;
  for (let i = endIdx - window + 1; i <= endIdx; i++) sum += closes[i];
  return sum / window;
}

/**
 * Bear regime at endIdx: sma50 < sma200. False when insufficient history.
 */
export function isBearAt(closes, endIdx) {
  const s50 = sma(closes, endIdx, 50);
  const s200 = sma(closes, endIdx, 200);
  if (Number.isNaN(s50) || Number.isNaN(s200)) return false;
  return s50 < s200;
}

/**
 * Build { date → bool } map for every date in the dates array.
 */
export function buildBearMap(dates, closes) {
  const out = {};
  for (let i = 0; i < dates.length; i++) {
    out[dates[i]] = isBearAt(closes, i);
  }
  return out;
}
