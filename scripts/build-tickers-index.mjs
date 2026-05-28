import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { getDb } from './lib/db.mjs';

const indexUrl = new URL('../public/tickers-index.json', import.meta.url);

try {
  const db = getDb();
  const res = await db.execute(`SELECT ticker, name_kr, name_en, market, exchange FROM tickers WHERE active = 1`);
  const out = res.rows.map((r) => ({
    ticker: r.ticker,
    name_kr: r.name_kr,
    name_en: r.name_en,
    market: r.market,
    exchange: r.exchange,
  }));

  mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
  writeFileSync(indexUrl, JSON.stringify(out));
  console.log(`✓ wrote public/tickers-index.json (${out.length} tickers)`);
} catch (e) {
  // DB 접속 불가(자격증명/네트워크 없음) 시: 이미 커밋된 인덱스가 있으면 그걸 그대로 사용해 build 를 막지 않음.
  // Vercel/GitHub Actions 처럼 DB 가 닿는 환경에서는 위 경로로 항상 최신 재생성됨.
  if (existsSync(indexUrl)) {
    console.warn(`⚠ DB 접속 실패(${e.message}). 기존 public/tickers-index.json 유지하고 진행.`);
  } else {
    console.error(`✗ DB 접속 실패이고 public/tickers-index.json 도 없음 — 인덱스 생성 불가.`);
    throw e;
  }
}
