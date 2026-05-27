import { describe, it, expect } from 'vitest';
import { sma, isBearAt, buildBearMap } from '../scripts/lib/regime-detect.mjs';

describe('sma', () => {
  it('mean of last N values ending at index', () => {
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(sma(closes, 9, 5)).toBe(8);
    expect(sma(closes, 4, 5)).toBe(3);
  });
  it('returns NaN if insufficient history', () => {
    const closes = [1, 2, 3];
    expect(Number.isNaN(sma(closes, 2, 5))).toBe(true);
  });
});

describe('isBearAt', () => {
  it('false when sma50 >= sma200', () => {
    const closes = Array.from({ length: 250 }, (_, i) => 100 + i);
    expect(isBearAt(closes, 249)).toBe(false);
  });
  it('true when sma50 < sma200', () => {
    const closes = Array.from({ length: 250 }, (_, i) => 200 - i * 0.5);
    expect(isBearAt(closes, 249)).toBe(true);
  });
  it('false when insufficient history (<200)', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(isBearAt(closes, 99)).toBe(false);
  });
});

describe('buildBearMap', () => {
  it('returns date→bool map aligned to dates array', () => {
    const dates = Array.from({ length: 250 }, (_, i) => `2024-${String(i).padStart(3, '0')}`);
    const closes = Array.from({ length: 250 }, (_, i) => 200 - i * 0.5);
    const map = buildBearMap(dates, closes);
    expect(map[dates[249]]).toBe(true);
    expect(map[dates[100]]).toBe(false);
  });
});
