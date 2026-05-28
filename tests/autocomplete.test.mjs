import { describe, it, expect } from 'vitest';
import { search } from '../src/lib/autocomplete.mjs';

const fixtures = [
  { ticker: '005930.KS', name_kr: '삼성전자', name_en: null, market: 'KR', exchange: 'KOSPI' },
  { ticker: '006400.KS', name_kr: '삼성SDI',  name_en: null, market: 'KR', exchange: 'KOSPI' },
  { ticker: 'AAPL',      name_kr: null,      name_en: 'Apple', market: 'US', exchange: 'NASDAQ' },
  { ticker: 'MSFT',      name_kr: null,      name_en: 'Microsoft', market: 'US', exchange: 'NASDAQ' },
];

describe('autocomplete.search', () => {
  it('빈 쿼리는 빈 결과', () => {
    expect(search(fixtures, '')).toEqual([]);
  });
  it('한국어 prefix 매칭', () => {
    const r = search(fixtures, '삼성');
    expect(r.map((x) => x.ticker)).toEqual(['005930.KS', '006400.KS']);
  });
  it('한국어 substring 매칭', () => {
    const r = search(fixtures, 'SDI');
    expect(r.map((x) => x.ticker)).toEqual(['006400.KS']);
  });
  it('영어 prefix 매칭 (대소문자 무시)', () => {
    const r = search(fixtures, 'app');
    expect(r.map((x) => x.ticker)).toEqual(['AAPL']);
  });
  it('ticker 코드 prefix 매칭', () => {
    const r = search(fixtures, '0059');
    expect(r.map((x) => x.ticker)).toEqual(['005930.KS']);
  });
  it('정확 일치가 prefix 보다 우선', () => {
    const r = search([...fixtures, { ticker: 'AA', name_en: 'AA Corp', market: 'US' }], 'AA');
    expect(r[0].ticker).toBe('AA');
  });
  it('limit 적용', () => {
    const r = search(fixtures, '', 0);
    expect(r).toHaveLength(0);
  });
});
