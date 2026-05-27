import { describe, it, expect } from 'vitest';
import { parseChartResult } from '../scripts/fetch-yahoo.mjs';

describe('parseChartResult', () => {
  it('aligns dates with closes after dropping null closes', () => {
    const result = {
      timestamp: [1640995200, 1641081600, 1641168000], // 2022-01-01,02,03 UTC
      indicators: {
        quote: [{
          close: [100, null, 102],
          volume: [1000, 2000, 3000],
          high: [101, 99, 103],
          low: [99, 97, 101],
        }],
      },
      meta: { regularMarketPrice: 102 },
    };
    const parsed = parseChartResult(result);
    expect(parsed.dates).toEqual(['2022-01-01', '2022-01-03']);
    expect(parsed.closes).toEqual([100, 102]);
    expect(parsed.volumes).toEqual([1000, 3000]);
    expect(parsed.dates.length).toBe(parsed.closes.length);
  });

  it('returns null when no close points survive', () => {
    const result = {
      timestamp: [1640995200],
      indicators: { quote: [{ close: [null], volume: [0], high: [0], low: [0] }] },
      meta: {},
    };
    expect(parseChartResult(result)).toBe(null);
  });
});
