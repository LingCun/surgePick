import { describe, it, expect } from 'vitest';
import { simulate } from '../scripts/lib/backtest-engine.mjs';

function buildSyntheticTicker({ ticker, name, market, startDate, n, closeFn }) {
  const dates = [];
  const closes = [];
  const d = new Date(startDate + 'T00:00:00Z');
  let i = 0;
  while (dates.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
      closes.push(closeFn(i));
      i++;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { ticker, name, market, dates, closes, volumes: closes.map(() => 1000), highs: closes, lows: closes };
}

describe('simulate (portfolio)', () => {
  it('returns equityCurve covering every sim day and ledger array', () => {
    const t = buildSyntheticTicker({
      ticker: 'A', name: 'A', market: 'KR', startDate: '2023-01-02', n: 250,
      closeFn: (i) => 100 + Math.sin(i / 5) * 2,
    });
    const result = simulate({
      tickers: [t],
      simStart: '2023-01-02', simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      initialCapital: { krInitial: 1_000_000, usInitial: 0 },
      indexByMarket: {},
      bearByMarket: {},
    });
    expect(result.equityCurve).toBeInstanceOf(Array);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.ledger).toBeInstanceOf(Array);
    expect(result.positions).toBeInstanceOf(Array);
  });

  it('opens a position via DCA when cheap signal appears', () => {
    // 200 rising days then plunge → final RSI<35, distance from MA200 < 10%
    const rising = Array.from({ length: 200 }, (_, i) => 100 + i * 0.1);
    const drop = [115, 114, 113, 110, 108, 105, 103, 102, 101, 100, 99, 98, 97, 96, 95];
    const closes = [...rising, ...drop];
    const t = buildSyntheticTicker({
      ticker: 'A', name: 'A', market: 'KR', startDate: '2023-01-02',
      n: closes.length, closeFn: (i) => closes[i],
    });
    const result = simulate({
      tickers: [t],
      simStart: '2023-01-02', simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      initialCapital: { krInitial: 1_000_000, usInitial: 0 },
      indexByMarket: {},
      bearByMarket: {},
    });
    const buys = result.ledger.filter((l) => l.action === 'buy' && l.ticker === 'A');
    expect(buys.length).toBeGreaterThan(0);
  });

  it('catastrophe gate fires when close drops 10% below avgCost', () => {
    // Cheap → buy → next-day gap-down past trailing band straight into catastrophe band.
    // For catastrophe to fire BEFORE trailing on the same day, close must be
    // < avgCost * 0.90. We engineer a one-day gap so this is the first breach.
    const rising = Array.from({ length: 200 }, (_, i) => 100 + i * 0.1);
    // Day 200 close=115 triggers cheap (RSI drops to ~21 from one big down day,
    // distance from MA200 ~4.5%). Position opens at 115 with peak=115.
    // Day 201 close=90 — gap-down 21%, which is < 115*0.90=103.5 (catastrophe
    // threshold) AND < 115*0.92=105.8 (trailing threshold). Since catastrophe
    // is checked first in evaluateExit, it fires with that reason.
    const closes = [...rising, 115, 90, 88, 85, 82, 80];
    const t = buildSyntheticTicker({
      ticker: 'A', name: 'A', market: 'KR', startDate: '2023-01-02',
      n: closes.length, closeFn: (i) => closes[i],
    });
    const result = simulate({
      tickers: [t],
      simStart: '2023-01-02', simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      initialCapital: { krInitial: 1_000_000, usInitial: 0 },
      indexByMarket: {},
      bearByMarket: {},
    });
    const closingSells = result.ledger.filter((l) => l.action === 'sell');
    // Catastrophe must fire on at least one position. With current exit ordering
    // (catastrophe checked first), a same-day breach of both trailing and
    // catastrophe is labeled 'catastrophe'.
    const catastropheSells = closingSells.filter((l) => l.reason === 'catastrophe');
    expect(catastropheSells.length).toBeGreaterThan(0);
  });

  it('bear-flip gate liquidates positions when regime turns bear', () => {
    // Day 200 close=115 triggers cheap (one big down day → RSI~21, close near
    // MA200). Buy at 115 (peak=115). Subsequent 50 days flat at 115 — trailing
    // band is 115*0.92=105.8, catastrophe at 115*0.90=103.5; close stays at
    // 115 so neither fires. On day 230, bear marker activates → bear-flip fires.
    const rising = Array.from({ length: 200 }, (_, i) => 100 + i * 0.1);
    const closes = [...rising, ...Array(50).fill(115)];
    const t = buildSyntheticTicker({
      ticker: 'A', name: 'A', market: 'KR', startDate: '2023-01-02',
      n: closes.length, closeFn: (i) => closes[i],
    });
    // Bear flag activates on day 230 of the series (well after position is held flat)
    const bearByMarket = { KR: Object.fromEntries(t.dates.map((d, i) => [d, i > 230])) };
    const result = simulate({
      tickers: [t],
      simStart: '2023-01-02', simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      initialCapital: { krInitial: 1_000_000, usInitial: 0 },
      indexByMarket: {},
      bearByMarket,
    });
    const bearSells = result.ledger.filter((l) => l.action === 'sell' && l.reason === 'bear-flip');
    expect(bearSells.length).toBeGreaterThan(0);
  });

  it('respects maxSlots cap (no more than 5 concurrent positions per market)', () => {
    // 6 tickers all hit cheap signal around the same window, then flatten so
    // none trigger trailing/catastrophe. Assert that finalState positions
    // never exceeds 5 — engine rejects the 6th entry.
    const mkClose = (offset) => (i) => {
      const base = 100 + offset;
      if (i < 200) return base + i * 0.1;       // rising to base+20
      if (i < 210) return base + 20 - (i - 200);// drops 10 points (cheap signal)
      if (i < 220) return base + 10 + (i - 210);// recovers
      return base + 20;                          // flat at base+20
    };
    const tickers = Array.from({ length: 6 }, (_, k) =>
      buildSyntheticTicker({
        ticker: `T${k}`, name: `T${k}`, market: 'KR', startDate: '2023-01-02',
        n: 230, closeFn: mkClose(k),
      }),
    );
    const result = simulate({
      tickers,
      simStart: '2023-01-02', simEnd: tickers[0].dates[229],
      today: tickers[0].dates[229],
      initialCapital: { krInitial: 10_000_000, usInitial: 0 },
      indexByMarket: {},
      bearByMarket: {},
    });
    // Final open positions must respect the cap.
    expect(result.positions.length).toBeLessThanOrEqual(5);
  });
});
