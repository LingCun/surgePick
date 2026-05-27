import { describe, it, expect } from 'vitest';
import { simulate } from '../scripts/lib/backtest-engine.mjs';

/**
 * Build a synthetic OHLCV series. Skips weekends so `dates` only contains
 * trading days. `closeFn(i)` and `volFn(i)` are evaluated in trading-day index.
 */
function synthTicker({ ticker, name, market, startDate, n, closeFn, volFn }) {
  const dates = [];
  const closes = [];
  const volumes = [];
  const highs = [];
  const lows = [];
  let d = new Date(startDate + 'T00:00:00Z');
  let i = 0;
  while (dates.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const c = closeFn(i);
      dates.push(ds);
      closes.push(c);
      volumes.push(volFn(i));
      highs.push(c * 1.005);
      lows.push(c * 0.995);
      i++;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { ticker, name, market, dates, closes, volumes, highs, lows };
}

// Sawtooth: 10 days up (+0.6 each), 1 day pullback (-3), repeating 11-day cycle
// with cumulative +3 per cycle. Produces overall uptrend with the last close
// sitting mid-range (satisfies pricePosition <= 0.8 at certain D), while
// the 30-day window keeps slope > 0.0002 and OBV slope positive.
const sawtoothClose = (i) => {
  const cyc = Math.floor(i / 11);
  const phase = i % 11;
  let base = 100 + cyc * 3;
  if (phase < 10) base += phase * 0.6;
  else base += 10 * 0.6 - 3;
  return base;
};

// Geometric volume growth — back-half mean / front-half mean > 1.10 for any
// 30-day window, and log-volume slope is positive (volSlope > 0).
const geomVol = (i) => 1000 * Math.pow(1.01, i);

// Pure linear down — guaranteed to fail trendUp (slope <= 0).
const linearDownClose = (i) => 100 - i * 0.2;
const flatVol = (i) => 1000 + i;

describe('simulate', () => {
  it('produces matured wins when prices rise with rising volume', () => {
    const t = synthTicker({
      ticker: 'UPUP',
      name: 'Up Up',
      market: 'US',
      startDate: '2024-01-03',
      n: 200,
      closeFn: sawtoothClose,
      volFn: geomVol,
    });
    const vixByDate = Object.fromEntries(t.dates.map((d) => [d, 25]));
    const entries = simulate({
      tickers: [t],
      simStart: '2024-01-03',
      simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      vixByDate,
    });
    expect(entries.length).toBeGreaterThan(0);
    const matured = entries.filter((e) => e.status === 'matured');
    expect(matured.length).toBeGreaterThan(0);
    expect(matured.every((e) => e.return > 0)).toBe(true);
  });

  it('produces zero entries on a pure downtrend', () => {
    const t = synthTicker({
      ticker: 'DNDN',
      name: 'Down Down',
      market: 'US',
      startDate: '2024-01-03',
      n: 200,
      closeFn: linearDownClose,
      volFn: flatVol,
    });
    const vixByDate = Object.fromEntries(t.dates.map((d) => [d, 25]));
    const entries = simulate({
      tickers: [t],
      simStart: '2024-01-03',
      simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      vixByDate,
    });
    expect(entries.length).toBe(0);
  });

  it('dedupes a single ticker — one entry per active hold window', () => {
    const t = synthTicker({
      ticker: 'UPUP',
      name: 'Up Up',
      market: 'US',
      startDate: '2024-01-03',
      n: 200,
      closeFn: sawtoothClose,
      volFn: geomVol,
    });
    const vixByDate = Object.fromEntries(t.dates.map((d) => [d, 25]));
    const entries = simulate({
      tickers: [t],
      simStart: '2024-01-03',
      simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      vixByDate,
    });
    // The fixture passes scorePicks filters on many days (~40+), but the
    // engine should dedupe so consecutive entries never overlap in hold time.
    expect(entries.length).toBeGreaterThan(0);
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const curr = entries[i];
      if (prev.ticker !== curr.ticker) continue;
      // Next buy must be strictly after previous matureDate (which is
      // prev.buyDate + holdDays). Use exitDate when matured (>= matureDate)
      // or use the active deadline (prev still holds at today). Either way,
      // curr.buyDate must be > prev.buyDate + a non-trivial gap.
      const prevBuy = new Date(prev.buyDate + 'T00:00:00Z').getTime();
      const currBuy = new Date(curr.buyDate + 'T00:00:00Z').getTime();
      const gapDays = (currBuy - prevBuy) / 86400000;
      expect(gapDays).toBeGreaterThanOrEqual(prev.holdDays);
    }
  });

  it('correctly distinguishes active vs matured at the today boundary', () => {
    // 120 trading days is long enough to produce one matured 90-day entry
    // and one still-active entry near the end of the series.
    const t = synthTicker({
      ticker: 'UPUP',
      name: 'Up Up',
      market: 'US',
      startDate: '2024-01-01',
      n: 120,
      closeFn: sawtoothClose,
      volFn: geomVol,
    });
    const vixByDate = Object.fromEntries(t.dates.map((d) => [d, 25]));
    const entries = simulate({
      tickers: [t],
      simStart: '2024-01-01',
      simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      vixByDate,
    });
    const matured = entries.filter((e) => e.status === 'matured');
    const active = entries.filter((e) => e.status === 'active');
    expect(matured.length).toBeGreaterThan(0);
    expect(active.length).toBeGreaterThan(0);
    // active entries have no exit info
    for (const e of active) {
      expect(e.exitDate).toBeNull();
      expect(e.exitPrice).toBeNull();
      expect(e.return).toBeNull();
    }
    // matured entries have full exit info
    for (const e of matured) {
      expect(e.exitDate).not.toBeNull();
      expect(e.exitPrice).not.toBeNull();
      expect(typeof e.return).toBe('number');
    }
  });

  it('slides matureDate forward to the next trading day for weekend matures', () => {
    function addCalendarDays(dateStr, days) {
      const d = new Date(dateStr + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + days);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    const t = synthTicker({
      ticker: 'UPUP',
      name: 'Up Up',
      market: 'US',
      startDate: '2024-01-03',
      n: 200,
      closeFn: sawtoothClose,
      volFn: geomVol,
    });
    const vixByDate = Object.fromEntries(t.dates.map((d) => [d, 25]));
    const entries = simulate({
      tickers: [t],
      simStart: '2024-01-03',
      simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      vixByDate,
    });
    const matured = entries.filter((e) => e.status === 'matured');
    expect(matured.length).toBeGreaterThan(0);
    const datesSet = new Set(t.dates);
    let slideObserved = false;
    for (const e of matured) {
      // exitDate must exist in the trading-day series
      expect(datesSet.has(e.exitDate)).toBe(true);
      // exitDate must be on or after matureDate
      const mat = addCalendarDays(e.buyDate, e.holdDays);
      expect(e.exitDate >= mat).toBe(true);
      if (e.exitDate !== mat) slideObserved = true;
    }
    // This particular fixture / start date is engineered so that at least
    // one matureDate lands on a weekend and slides forward.
    expect(slideObserved).toBe(true);
  });

  it('exits early via sellReason="vix" when VIX drops below 15 mid-hold', () => {
    const t = synthTicker({
      ticker: 'VIXEX',
      name: 'VIX Exit',
      market: 'US',
      startDate: '2024-01-03',
      n: 200,
      closeFn: (i) => {
        const c = i % 11;
        return 100 + Math.floor(i / 11) * 3 + (c < 10 ? c * 0.6 : 10 * 0.6 - 3);
      },
      volFn: (i) => Math.round(1000 * Math.pow(1.01, i)),
    });
    const vixByDate = Object.fromEntries(
      t.dates.map((d, i) => [d, i < 100 ? 25 : 12])
    );
    const today = t.dates[t.dates.length - 1];
    const entries = simulate({
      tickers: [t],
      simStart: '2024-01-03',
      simEnd: today,
      today,
      vixByDate,
    });
    const matured = entries.filter((e) => e.status === 'matured');
    expect(matured.length).toBeGreaterThan(0);
    expect(matured.some((e) => e.sellReason === 'vix')).toBe(true);
    expect(matured.every((e) => e.vixAtBuy != null)).toBe(true);
  });
});
