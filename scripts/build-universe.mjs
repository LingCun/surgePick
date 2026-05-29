import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// KOSPI 200 / S&P 500 / KOSDAQ scrape 외 수동 종목. 자동 빌드 후에도 살아남음.
const EXTRAS_KR = [
  // 사용자 요청 KOSDAQ 종목
  { ticker: '163730.KQ', name: '핑거', market: 'KOSDAQ' },
  { ticker: '043260.KQ', name: '성호전자', market: 'KOSDAQ' },
  // KR ETFs (KOSPI 상장)
  { ticker: '069500.KS', name: 'KODEX 200',                 market: 'KOSPI' },
  { ticker: '102110.KS', name: 'TIGER 200',                 market: 'KOSPI' },
  { ticker: '122630.KS', name: 'KODEX 레버리지',            market: 'KOSPI' },
  { ticker: '114800.KS', name: 'KODEX 인버스',              market: 'KOSPI' },
  { ticker: '252670.KS', name: 'KODEX 200선물인버스2X',     market: 'KOSPI' },
  { ticker: '133690.KS', name: 'TIGER 미국나스닥100',       market: 'KOSPI' },
  { ticker: '360750.KS', name: 'TIGER 미국S&P500',          market: 'KOSPI' },
  { ticker: '381180.KS', name: 'TIGER 미국필라델피아반도체나스닥', market: 'KOSPI' },
  { ticker: '229200.KS', name: 'KODEX 코스닥150',           market: 'KOSPI' },
  { ticker: '233740.KS', name: 'KODEX 코스닥150 레버리지',  market: 'KOSPI' },
  { ticker: '251340.KS', name: 'KODEX 코스닥150 선물인버스', market: 'KOSPI' },
  { ticker: '091230.KS', name: 'TIGER 반도체',              market: 'KOSPI' },
];
const EXTRAS_US = [
  // 메이저 인덱스 ETF
  { ticker: 'SPY',  name: 'SPDR S&P 500',                market: 'NYSEARCA' },
  { ticker: 'QQQ',  name: 'Invesco QQQ Trust',           market: 'NASDAQ'   },
  { ticker: 'VOO',  name: 'Vanguard S&P 500',            market: 'NYSEARCA' },
  { ticker: 'IWM',  name: 'iShares Russell 2000',        market: 'NYSEARCA' },
  { ticker: 'DIA',  name: 'SPDR Dow Jones',              market: 'NYSEARCA' },
  // 섹터 ETF
  { ticker: 'XLK',  name: 'Technology Select Sector',    market: 'NYSEARCA' },
  { ticker: 'XLE',  name: 'Energy Select Sector',        market: 'NYSEARCA' },
  { ticker: 'XLF',  name: 'Financial Select Sector',     market: 'NYSEARCA' },
  { ticker: 'XLV',  name: 'Health Care Select Sector',   market: 'NYSEARCA' },
  { ticker: 'XLY',  name: 'Consumer Discretionary Select Sector', market: 'NYSEARCA' },
  { ticker: 'SMH',  name: 'VanEck Semiconductor',        market: 'NASDAQ'   },
  // 레버리지/인버스
  { ticker: 'TQQQ', name: 'ProShares UltraPro QQQ (3x)', market: 'NASDAQ'   },
  { ticker: 'SQQQ', name: 'ProShares UltraPro Short QQQ (-3x)', market: 'NASDAQ' },
  { ticker: 'SOXL', name: 'Direxion Daily Semi Bull 3x', market: 'NYSEARCA' },
  { ticker: 'SOXS', name: 'Direxion Daily Semi Bear 3x', market: 'NYSEARCA' },
  { ticker: 'UPRO', name: 'ProShares UltraPro S&P 500 (3x)', market: 'NYSEARCA' },
  { ticker: 'SPXU', name: 'ProShares UltraPro Short S&P 500 (-3x)', market: 'NYSEARCA' },
  { ticker: 'TMF',  name: 'Direxion 20+ Year Treasury Bull 3x', market: 'NYSEARCA' },
  { ticker: 'TMV',  name: 'Direxion 20+ Year Treasury Bear 3x', market: 'NYSEARCA' },
  // 변동성/원자재/테마
  { ticker: 'UVXY', name: 'ProShares Ultra VIX Short-Term', market: 'NYSEARCA' },
  { ticker: 'VXX',  name: 'iPath Series B S&P 500 VIX',  market: 'NYSEARCA' },
  { ticker: 'GLD',  name: 'SPDR Gold Shares',            market: 'NYSEARCA' },
  { ticker: 'SLV',  name: 'iShares Silver Trust',        market: 'NYSEARCA' },
  { ticker: 'USO',  name: 'United States Oil Fund',      market: 'NYSEARCA' },
  { ticker: 'ARKK', name: 'ARK Innovation',              market: 'NYSEARCA' },
];

// KOSDAQ 시가총액 상위 종목 — 자동 빌드 보충용 (Wikipedia 페이지 없음).
const KOSDAQ_TOP = [
  { ticker: '247540.KQ', name: '에코프로비엠',    market: 'KOSDAQ' },
  { ticker: '086520.KQ', name: '에코프로',        market: 'KOSDAQ' },
  { ticker: '196170.KQ', name: '알테오젠',        market: 'KOSDAQ' },
  { ticker: '091990.KQ', name: '셀트리온헬스케어', market: 'KOSDAQ' },
  { ticker: '028300.KQ', name: 'HLB',             market: 'KOSDAQ' },
  { ticker: '141080.KQ', name: '리가켐바이오',    market: 'KOSDAQ' },
  { ticker: '263750.KQ', name: '펄어비스',        market: 'KOSDAQ' },
  { ticker: '293490.KQ', name: '카카오게임즈',    market: 'KOSDAQ' },
  { ticker: '058470.KQ', name: '리노공업',        market: 'KOSDAQ' },
  { ticker: '214150.KQ', name: '클래시스',        market: 'KOSDAQ' },
  { ticker: '145020.KQ', name: '휴젤',            market: 'KOSDAQ' },
  { ticker: '357780.KQ', name: '솔브레인',        market: 'KOSDAQ' },
  { ticker: '042700.KQ', name: '한미반도체',      market: 'KOSDAQ' },
  { ticker: '112040.KQ', name: '위메이드',        market: 'KOSDAQ' },
  { ticker: '005290.KQ', name: '동진쎄미켐',      market: 'KOSDAQ' },
  { ticker: '068760.KQ', name: '셀트리온제약',    market: 'KOSDAQ' },
  { ticker: '066970.KQ', name: '엘앤에프',        market: 'KOSDAQ' },
  { ticker: '403870.KQ', name: 'HPSP',            market: 'KOSDAQ' },
  { ticker: '277810.KQ', name: '레인보우로보틱스', market: 'KOSDAQ' },
  { ticker: '348370.KQ', name: '엔켐',            market: 'KOSDAQ' },
  { ticker: '035900.KQ', name: 'JYP Ent.',        market: 'KOSDAQ' },
  { ticker: '041510.KQ', name: '에스엠',          market: 'KOSDAQ' },
  { ticker: '122870.KQ', name: '와이지엔터테인먼트', market: 'KOSDAQ' },
  { ticker: '078340.KQ', name: '컴투스',          market: 'KOSDAQ' },
  { ticker: '215200.KQ', name: '메가스터디교육',   market: 'KOSDAQ' },
  { ticker: '181710.KQ', name: 'NHN',             market: 'KOSDAQ' },
  { ticker: '035760.KQ', name: 'CJ ENM',          market: 'KOSDAQ' },
  { ticker: '087010.KQ', name: '펩트론',          market: 'KOSDAQ' },
  { ticker: '376300.KQ', name: '디어유',          market: 'KOSDAQ' },
  { ticker: '067160.KQ', name: '아프리카TV',      market: 'KOSDAQ' },
  { ticker: '317870.KQ', name: '엔바이오니아',    market: 'KOSDAQ' },
  { ticker: '950140.KQ', name: '잉글우드랩',      market: 'KOSDAQ' },
  { ticker: '950130.KQ', name: '엑세스바이오',    market: 'KOSDAQ' },
  { ticker: '950170.KQ', name: 'JTC',             market: 'KOSDAQ' },
  { ticker: '044340.KQ', name: '위닉스',          market: 'KOSDAQ' },
  { ticker: '237690.KQ', name: '에스티팜',        market: 'KOSDAQ' },
  { ticker: '328130.KQ', name: '루닛',            market: 'KOSDAQ' },
  { ticker: '388720.KQ', name: '대명에너지',      market: 'KOSDAQ' },
  { ticker: '432320.KQ', name: 'KCC글라스',       market: 'KOSDAQ' },
  { ticker: '267980.KQ', name: '매일유업',        market: 'KOSDAQ' },
  { ticker: '039840.KQ', name: '디오',            market: 'KOSDAQ' },
  { ticker: '108860.KQ', name: '셀바스AI',        market: 'KOSDAQ' },
  { ticker: '241790.KQ', name: '오션브릿지',      market: 'KOSDAQ' },
  { ticker: '294870.KQ', name: 'HLB생명과학',     market: 'KOSDAQ' },
  { ticker: '950210.KQ', name: '프레스티지바이오파마', market: 'KOSDAQ' },
  { ticker: '042660.KQ', name: '한화오션',        market: 'KOSDAQ' },
  { ticker: '226320.KQ', name: '잇츠한불',        market: 'KOSDAQ' },
  { ticker: '900290.KQ', name: 'GRT',             market: 'KOSDAQ' },
  { ticker: '900100.KQ', name: '뉴프라이드',      market: 'KOSDAQ' },
  { ticker: '900250.KQ', name: '크리스탈신소재',  market: 'KOSDAQ' },
];

const stripTags = (s) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .trim();

// Wikipedia "List of S&P 500 companies" → ~500 tickers.
async function fetchSP500() {
  const res = await fetch('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', {
    headers: { 'User-Agent': 'Mozilla/5.0 surgepick-builder' },
  });
  if (!res.ok) throw new Error(`SP500 fetch HTTP ${res.status}`);
  const html = await res.text();
  const tableMatch = html.match(/<table[^>]*id="constituents"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) throw new Error('S&P 500 constituents table not found');
  const rows = [...tableMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  const list = [];
  for (const r of rows) {
    const cells = [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)];
    if (cells.length < 4) continue;
    let ticker = stripTags(cells[0][1]);
    const name = stripTags(cells[1][1]);
    if (!ticker || !name) continue;
    if (!/^[A-Z][A-Z0-9.\-]*$/.test(ticker)) continue;
    ticker = ticker.replace(/\./g, '-');
    list.push({ ticker, name, market: 'SP500' });
  }
  return list;
}

// Korean Wikipedia "KOSPI 200" → ~200 tickers with Korean company names.
async function fetchKospi200() {
  const res = await fetch('https://ko.wikipedia.org/wiki/KOSPI_200', {
    headers: { 'User-Agent': 'Mozilla/5.0 surgepick-builder' },
  });
  if (!res.ok) throw new Error(`KOSPI 200 fetch HTTP ${res.status}`);
  const html = await res.text();
  const pattern = /<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>\s*(\d{6})\s*<\/td>/g;
  const seen = new Map();
  for (const m of html.matchAll(pattern)) {
    const raw = stripTags(m[1]);
    const name = raw.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean).pop();
    const code = m[2];
    if (!name) continue;
    const ticker = `${code}.KS`;
    if (!seen.has(ticker)) seen.set(ticker, { ticker, name, market: 'KOSPI' });
  }
  return [...seen.values()];
}

async function main() {
  console.log('[build-universe] fetching S&P 500...');
  const us = await fetchSP500();
  console.log(`  → ${us.length} tickers`);
  if (us.length < 400) throw new Error(`S&P 500 too small: ${us.length}`);

  console.log('[build-universe] fetching KOSPI 200...');
  const kr = await fetchKospi200();
  console.log(`  → ${kr.length} tickers`);
  if (kr.length < 100) throw new Error(`KOSPI 200 too small: ${kr.length}`);

  // 자동 빌드 + KOSDAQ 상위 + 수동 extras 머지 (중복은 ticker 기준 dedup).
  const usMerged = dedupByTicker([...us, ...EXTRAS_US]);
  const krMerged = dedupByTicker([...kr, ...KOSDAQ_TOP, ...EXTRAS_KR]);

  writeFileSync(resolve(__dirname, 'universe-us.json'), JSON.stringify(usMerged, null, 2) + '\n');
  writeFileSync(resolve(__dirname, 'universe-kr.json'), JSON.stringify(krMerged, null, 2) + '\n');
  console.log(`✓ wrote universe-us.json (${usMerged.length}) + universe-kr.json (${krMerged.length})`);
}

function dedupByTicker(arr) {
  const seen = new Map();
  for (const x of arr) if (!seen.has(x.ticker)) seen.set(x.ticker, x);
  return [...seen.values()];
}

main().catch((err) => {
  console.error('[build-universe] failed:', err);
  process.exit(1);
});
