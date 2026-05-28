import { describe, it, expect } from 'vitest';
import { matchCases, normalizeTrajectory, aggregateBands, predict } from '../src/lib/predict.mjs';

const regime = [
  { date: '2024-01-01', market: 'US', label: 'bull', vix_band: 'low' },
  { date: '2024-02-01', market: 'US', label: 'bull', vix_band: 'low' },
  { date: '2024-03-01', market: 'US', label: 'bear', vix_band: 'high' },
  { date: '2024-04-01', market: 'US', label: 'bull', vix_band: 'mid' },
  { date: '2024-05-01', market: 'US', label: 'bull', vix_band: 'low' },
];

describe('matchCases', () => {
  it('정확 매칭 (label + vix_band)', () => {
    const r = matchCases(regime, { market: 'US', label: 'bull', vix_band: 'low' }, '2024-06-01', 30);
    expect(r.map((x) => x.date)).toEqual(['2024-05-01', '2024-02-01', '2024-01-01']);
  });
  it('오버랩 윈도우 제외 (case + horizon > today)', () => {
    const r = matchCases(regime, { market: 'US', label: 'bull', vix_band: 'low' }, '2024-05-15', 30);
    // 2024-05-01 은 +30일 = 2024-05-31, today 2024-05-15 넘어감 → 제외
    expect(r.map((x) => x.date)).toEqual(['2024-02-01', '2024-01-01']);
  });
});

describe('normalizeTrajectory', () => {
  it('case_date 기준 정규화 r(d) = close/close_0 - 1', () => {
    const prices = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 110 },
      { date: '2024-01-03', close: 121 },
    ];
    const r = normalizeTrajectory(prices, '2024-01-01', 2);
    expect(r[0]).toBe(0);
    expect(r[1]).toBeCloseTo(0.1);
    expect(r[2]).toBeCloseTo(0.21);
  });
  it('가격 결측 일자는 null 채움', () => {
    const prices = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-03', close: 121 },
    ];
    const r = normalizeTrajectory(prices, '2024-01-01', 2);
    expect(r[0]).toBe(0);
    expect(r[1]).toBeNull();
    expect(r[2]).toBeCloseTo(0.21);
  });
  it('case_date 가 prices 에 없으면 null 반환', () => {
    expect(normalizeTrajectory([{ date: '2024-02-01', close: 100 }], '2024-01-01', 2)).toBeNull();
  });
});

describe('aggregateBands', () => {
  it('각 d 별 p25/p50/p75 계산', () => {
    const trajectories = [
      [0, 0.10, 0.20],
      [0, 0.05, 0.15],
      [0, 0.00, 0.10],
    ];
    const r = aggregateBands(trajectories, 2);
    expect(r[0]).toEqual({ d: 0, p25: 0, p50: 0, p75: 0 });
    expect(r[1].p50).toBeCloseTo(0.05);
  });
  it('null 값은 percentile 계산에서 제외', () => {
    const trajectories = [
      [0, 0.10, 0.20],
      [0, null,  0.15],
      [0, 0.00,  0.10],
    ];
    const r = aggregateBands(trajectories, 2);
    expect(r[1].p50).toBeCloseTo(0.05);  // [0, 0.1] 중앙값
  });
});

describe('predict', () => {
  const prices = Array.from({ length: 100 }, (_, i) => ({
    date: `2024-0${1 + Math.floor(i / 30)}-${String((i % 30) + 1).padStart(2, '0')}`,
    close: 100 + i,
  }));
  it('매칭 case 10 건 미만이면 vix_band drop 폴백', () => {
    const limitedRegime = regime.slice(0, 1);  // 'bull/low' 1건만
    // today 는 prices 시리즈(2024-01~04)에 실재하는 마지막 일자. 'YYYY-MM-DD' 문자열 키 매칭이므로 실제 달력일과 무관.
    const r = predict({ prices, regime: limitedRegime, ctx: { market: 'US', label: 'bull', vix_band: 'low' }, today: '2024-04-10', horizon: 5 });
    expect(r.case_count).toBeGreaterThan(0);
    expect(r.fallback).toBe(true);
  });
});
