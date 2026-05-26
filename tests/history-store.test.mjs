import { describe, it, expect } from 'vitest';
import { addDays, hasPickToday, makeEntry, updateEntry } from '../scripts/lib/history-store.mjs';

describe('addDays', () => {
  it('adds 14 days', () => {
    expect(addDays('2026-05-26', 14)).toBe('2026-06-09');
  });
  it('adds 90 days', () => {
    expect(addDays('2026-01-01', 90)).toBe('2026-04-01');
  });
  it('adds 365 days', () => {
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });
});

describe('hasPickToday', () => {
  it('returns true when entry exists for market+date', () => {
    const h = [{ market: 'KR', buyDate: '2026-05-26' }];
    expect(hasPickToday(h, 'KR', '2026-05-26')).toBe(true);
  });
  it('returns false for different market', () => {
    const h = [{ market: 'KR', buyDate: '2026-05-26' }];
    expect(hasPickToday(h, 'US', '2026-05-26')).toBe(false);
  });
});

describe('makeEntry', () => {
  it('builds entry with id + matureDate', () => {
    const e = makeEntry({
      market: 'KR',
      buyDate: '2026-05-26',
      pick: {
        ticker: '005930.KS',
        name: '삼성전자',
        buyPrice: 74500,
        horizon: '단기',
        holdDays: 14,
        reason: 'reason',
        score: 78,
        metrics: {},
        scores: {},
        closes30: [],
      },
    });
    expect(e.id).toBe('kr-2026-05-26-005930KS');
    expect(e.matureDate).toBe('2026-06-09');
    expect(e.status).toBe('holding');
    expect(e.returnPct).toBe(0);
  });
});

describe('updateEntry', () => {
  const base = {
    id: 'kr-2026-05-01-005930KS',
    market: 'KR',
    buyDate: '2026-05-01',
    buyPrice: 100,
    matureDate: '2026-05-15',
    holdDays: 14,
    status: 'holding',
    currentPrice: 100,
    currentDate: '2026-05-01',
    returnPct: 0,
    sellDate: null,
    sellPrice: null,
  };

  it('updates currentPrice + returnPct when still holding', () => {
    const r = updateEntry(base, 105, '2026-05-08');
    expect(r.currentPrice).toBe(105);
    expect(r.returnPct).toBeCloseTo(5, 5);
    expect(r.status).toBe('holding');
    expect(r.sellDate).toBe(null);
  });

  it('transitions to sold at maturity', () => {
    const r = updateEntry(base, 110, '2026-05-15');
    expect(r.status).toBe('sold');
    expect(r.sellDate).toBe('2026-05-15');
    expect(r.sellPrice).toBe(110);
    expect(r.returnPct).toBeCloseTo(10, 5);
  });

  it('transitions to sold past maturity', () => {
    const r = updateEntry(base, 95, '2026-05-20');
    expect(r.status).toBe('sold');
    expect(r.sellPrice).toBe(95);
    expect(r.returnPct).toBeCloseTo(-5, 5);
  });

  it('does not modify sold entries', () => {
    const sold = { ...base, status: 'sold', sellPrice: 110, returnPct: 10 };
    const r = updateEntry(sold, 200, '2026-06-01');
    expect(r).toBe(sold);
  });
});
