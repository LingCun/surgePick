import { describe, it, expect } from 'vitest';
import { portfolioMetrics, sellReasonBreakdown } from '../scripts/lib/backtest-aggregate.mjs';

describe('portfolioMetrics', () => {
  it('computes CAGR over a 1-year equity doubling', () => {
    const curve = [
      { date: '2024-01-02', total: 1_000_000 },
      { date: '2025-01-02', total: 2_000_000 },
    ];
    const m = portfolioMetrics(curve);
    expect(m.cagr).toBeCloseTo(1.0, 2);
  });
  it('computes max drawdown', () => {
    const curve = [
      { date: '2024-01-02', total: 1_000_000 },
      { date: '2024-02-02', total: 1_200_000 },
      { date: '2024-03-02', total: 900_000 },
      { date: '2024-04-02', total: 1_100_000 },
    ];
    const m = portfolioMetrics(curve);
    expect(m.maxDrawdown).toBeCloseTo(0.25, 2);
  });
  it('computes Sharpe (mean daily return / stdev * sqrt(252))', () => {
    const curve = Array.from({ length: 252 }, (_, i) => ({
      date: `2024-${String(Math.floor(i / 21) + 1).padStart(2, '0')}-02`,
      total: 1_000_000 * Math.pow(1.001, i),
    }));
    const m = portfolioMetrics(curve);
    expect(m.sharpe).toBeGreaterThan(0);
  });
  it('handles single-point curve gracefully', () => {
    const m = portfolioMetrics([{ date: '2024-01-02', total: 1_000_000 }]);
    expect(m.cagr).toBe(0);
    expect(m.maxDrawdown).toBe(0);
    expect(m.sharpe).toBe(0);
  });
});

describe('sellReasonBreakdown', () => {
  it('counts sells per reason', () => {
    const ledger = [
      { action: 'sell', reason: 'catastrophe' },
      { action: 'sell', reason: 'trailing' },
      { action: 'sell', reason: 'trailing' },
      { action: 'sell', reason: 'dist-chunk' },
      { action: 'buy', reason: 'dca-start' },
    ];
    const b = sellReasonBreakdown(ledger);
    expect(b).toEqual({ catastrophe: 1, trailing: 2, 'dist-chunk': 1 });
  });
});
