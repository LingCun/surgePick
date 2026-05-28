/**
 * 종목 자동완성 검색.
 * 매칭 우선순위: 정확 일치 > ticker prefix > 이름 prefix > 이름 substring.
 * 같은 등급 안에서는 입력 순서(=원본 정렬, 흔히 시총 순).
 *
 * @param {Array<{ticker:string, name_kr:string|null, name_en:string|null}>} index
 * @param {string} query
 * @param {number} limit
 * @returns {Array}
 */
export function search(index, query, limit = 8) {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return [];

  const exact = [];
  const tickerPrefix = [];
  const namePrefix = [];
  const substring = [];

  for (const item of index) {
    const ticker = item.ticker.toLowerCase();
    const nameKr = (item.name_kr ?? '').toLowerCase();
    const nameEn = (item.name_en ?? '').toLowerCase();

    if (ticker === q) {
      exact.push(item);
    } else if (ticker.startsWith(q)) {
      tickerPrefix.push(item);
    } else if (nameKr.startsWith(q) || nameEn.startsWith(q)) {
      namePrefix.push(item);
    } else if (nameKr.includes(q) || nameEn.includes(q)) {
      substring.push(item);
    }
  }

  return [...exact, ...tickerPrefix, ...namePrefix, ...substring].slice(0, limit);
}
