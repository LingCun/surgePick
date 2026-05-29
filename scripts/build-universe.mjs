import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    // Yahoo uses '-' for share class (BRK-B), Wikipedia/CSV uses '.' (BRK.B)
    ticker = ticker.replace(/\./g, '-');
    list.push({ ticker, name, market: 'SP500' });
  }
  return list;
}

// Naver Finance "KOSPI 200" — paginated HTML (20 rows/page, ~10 pages).
async function fetchKospi200() {
  const seen = new Map();
  for (let page = 1; page <= 12; page++) {
    const url = `https://finance.naver.com/sise/entryJongmok.naver?sosok=KPI200&page=${page}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 surgepick-builder',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      console.warn(`[kospi200] page ${page} HTTP ${res.status}`);
      break;
    }
    const html = await res.text();
    const matches = [...html.matchAll(/<a[^>]+href="\/item\/main\.naver\?code=(\d{6})"[^>]*>([^<]+)<\/a>/g)];
    if (matches.length === 0) break;
    for (const m of matches) {
      const ticker = `${m[1]}.KS`;
      const name = stripTags(m[2]);
      if (!seen.has(ticker)) seen.set(ticker, { ticker, name, market: 'KOSPI' });
    }
    await sleep(300);
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

  writeFileSync(resolve(__dirname, 'universe-us.json'), JSON.stringify(us, null, 2) + '\n');
  writeFileSync(resolve(__dirname, 'universe-kr.json'), JSON.stringify(kr, null, 2) + '\n');
  console.log(`✓ wrote universe-us.json (${us.length}) + universe-kr.json (${kr.length})`);
}

main().catch((err) => {
  console.error('[build-universe] failed:', err);
  process.exit(1);
});
