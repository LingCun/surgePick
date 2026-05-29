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

// Wikipedia "KOSPI 200" → ~200 tickers. Table format: name | symbol(6-digit) | GICS sector.
async function fetchKospi200() {
  const res = await fetch('https://en.wikipedia.org/wiki/KOSPI_200', {
    headers: { 'User-Agent': 'Mozilla/5.0 surgepick-builder' },
  });
  if (!res.ok) throw new Error(`KOSPI 200 fetch HTTP ${res.status}`);
  const html = await res.text();
  // Find first wikitable containing 6-digit codes.
  const tables = [...html.matchAll(/<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/g)];
  const seen = new Map();
  for (const t of tables) {
    const rows = [...t[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
    for (const r of rows) {
      const cells = [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)];
      if (cells.length < 2) continue;
      const c0 = stripTags(cells[0][1]);
      const c1 = stripTags(cells[1][1]);
      // 표 헤더에 따라 (name, code) 또는 (code, name) 가능 — 6자리 코드 자동 인식.
      let code = null;
      let name = null;
      if (/^\d{6}$/.test(c1)) { code = c1; name = c0; }
      else if (/^\d{6}$/.test(c0)) { code = c0; name = c1; }
      if (!code || !name) continue;
      const ticker = `${code}.KS`;
      if (!seen.has(ticker)) seen.set(ticker, { ticker, name, market: 'KOSPI' });
    }
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
