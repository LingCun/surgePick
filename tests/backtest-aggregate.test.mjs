import { describe, it, expect } from 'vitest';
import { bucketize } from '../scripts/lib/backtest-aggregate.mjs';

const matured = (overrides) => ({
  market: 'US',
  buyDate: '2024-06-01',
  exitDate: '2024-08-30',
  return: 0.1,
  horizon: '중기',
  status: 'matured',
  ...overrides,
});
const active = (overrides) => ({
  market: 'US',
  buyDate: '2026-05-01',
  exitDate: null,
  return: null,
  horizon: '단기',
  status: 'active',
  ...overrides,
});

describe('bucketize', () => {
  it('totals: count/winRate/mean/median over matured only', () => {
    const entries = [
      matured({ return: 0.10 }),
      matured({ return: -0.05 }),
      matured({ return: 0.20 }),
      matured({ return: -0.10 }),
      active({}),
    ];
    const out = bucketize(entries, { overall: 1000, byMarket: { KR: 500, US: 500 }, byYear: { '2024': 250 } });
    expect(out.totals.count).toBe(4);
    expect(out.totals.active).toBe(1);
    expect(out.totals.winRate).toBeCloseTo(0.5, 5);
    expect(out.totals.meanReturn).toBeCloseTo(0.0375, 5);
    expect(out.totals.medianReturn).toBeCloseTo(0.025, 5);
    expect(out.totals.pickRate).toBeCloseTo(4 / 1000, 5);
  });

  it('emits null metrics (not NaN) when bucket count is zero', () => {
    const entries = [matured({ market: 'US', horizon: '중기' })];
    const out = bucketize(entries, { overall: 100, byMarket: { KR: 50, US: 50 }, byYear: {} });
    expect(out.byMarket.KR.count).toBe(0);
    expect(out.byMarket.KR.winRate).toBe(null);
    expect(out.byMarket.KR.meanReturn).toBe(null);
    expect(out.byMarket.KR.medianReturn).toBe(null);
    expect(Number.isNaN(out.byMarket.KR.winRate)).toBe(false);
  });

  it('excludes active entries from winRate/mean but counts in totals.active', () => {
    const entries = [
      matured({ return: 0.10 }),
      active({ return: null }),
      active({ return: null }),
    ];
    const out = bucketize(entries, { overall: 100, byMarket: { KR: 50, US: 50 }, byYear: {} });
    expect(out.totals.count).toBe(1);
    expect(out.totals.active).toBe(2);
    expect(out.totals.winRate).toBe(1);
  });

  it('byYear.pickRate uses year-scoped simDays denominator', () => {
    const entries = [
      matured({ buyDate: '2022-03-01', return: -0.1 }),
      matured({ buyDate: '2024-03-01', return: 0.1 }),
      matured({ buyDate: '2024-04-01', return: 0.2 }),
    ];
    const out = bucketize(entries, {
      overall: 1000,
      byMarket: { KR: 500, US: 500 },
      byYear: { '2022': 252, '2023': 250, '2024': 251 },
    });
    expect(out.byYear['2022'].count).toBe(1);
    expect(out.byYear['2022'].pickRate).toBeCloseTo(1 / 252, 5);
    expect(out.byYear['2023'].count).toBe(0);
    expect(out.byYear['2023'].pickRate).toBe(0);
    expect(out.byYear['2024'].count).toBe(2);
    expect(out.byYear['2024'].pickRate).toBeCloseTo(2 / 251, 5);
  });
});
