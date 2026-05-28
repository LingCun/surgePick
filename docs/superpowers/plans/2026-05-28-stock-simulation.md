# 종목 시뮬레이션 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** surgePick 을 단일 종목 case-based 시뮬레이터로 피벗 — 종목 자동완성 검색, 일일 시가/종가 표, 과거 + 미래 1·2·3개월 예측 차트(progressive draw).

**Architecture:** Astro 4 정적 사이트를 hybrid 로 전환해서 API 라우트 2개를 SSR 로 서빙. 데이터는 Turso(libSQL/SQLite) 에 `tickers / prices / regime` 3 테이블로 적재. 예측은 case-based — 오늘의 regime 라벨 + VIX 구간과 같았던 과거 일자들을 매칭해서 그 종목의 정규화 궤적을 percentile 집계.

**Tech Stack:** Astro 4, Node 20, `@libsql/client`, `@astrojs/vercel/serverless`, Chart.js (CDN), Tailwind 3, Vitest.

**관련 spec:** `docs/superpowers/specs/2026-05-28-stock-simulation-design.md`

---

## 파일 구조

### 신규 파일
| 경로 | 책임 |
|---|---|
| `scripts/db/schema.sql` | tickers/prices/regime DDL |
| `scripts/db/apply-schema.mjs` | schema.sql 을 Turso 에 적용 |
| `scripts/lib/db.mjs` | libsql 클라이언트 (서버·스크립트 공통) |
| `scripts/lib/yahoo-with-open.mjs` | 기존 fetch-yahoo 에 open 필드 추가 |
| `scripts/ingest-tickers.mjs` | universe JSON → tickers 테이블 |
| `scripts/backfill-prices.mjs` | Yahoo 5년 일괄 → prices 테이블 |
| `scripts/ingest-prices.mjs` | 매일 어제 한 줄씩 incremental |
| `scripts/ingest-regime.mjs` | regime.json → regime 테이블 (label + vix_band 변환) |
| `scripts/build-tickers-index.mjs` | tickers → public/tickers-index.json (정적 자동완성 인덱스) |
| `src/lib/db.mjs` | 서버 라우트용 libsql 클라이언트 (env 기반) |
| `src/lib/autocomplete.mjs` | prefix/substring 검색 함수 |
| `src/lib/autocomplete.test.ts` | 단위 테스트 |
| `src/lib/predict.mjs` | case 매칭 + percentile 집계 |
| `src/lib/predict.test.ts` | 단위 테스트 |
| `src/pages/sim.astro` | 종목 시뮬레이션 페이지 |
| `src/pages/api/search.ts` | GET ?q= → tickers JSON |
| `src/pages/api/ticker.ts` | GET ?id=&horizon= → prices/context/forecast |
| `src/components/TickerSearch.astro` | 자동완성 입력 + 결과 드롭다운 |
| `src/components/PriceTable.astro` | 최근 10거래일 OHLC 표 |
| `src/components/ForecastChart.astro` | Chart.js 차트 + progressive draw + horizon 토글 |

### 수정 파일
| 경로 | 변경 |
|---|---|
| `package.json` | `@libsql/client` 의존성 추가, scripts 정리 |
| `astro.config.mjs` | `output: 'static'` → `output: 'hybrid'`, adapter `static` → `serverless` |
| `src/layouts/Base.astro` | 네비게이션 (시장 / 종목 시뮬레이션) 추가 |
| `.github/workflows/scan.yml` | scan-regime 후 ingest-regime + ingest-prices 추가 |
| `README.md` | 신규 컨셉으로 재작성 |

### 삭제 파일 (Phase 6 일괄)
- 페이지: `src/pages/portfolio.astro`, `watchlist.astro`, `stats.astro`
- 컴포넌트: `EquityCurve`, `PositionRow`, `PickCard`, `StatsTable`, `HistoryRow`, `Sparkline`, `ThemeCard`, `ThemeCarousel`, `ThemeTabs`, `ActionButton`
- 스크립트: `scripts/{backtest,scan-picks,scan-themes,tune-vix}.mjs`
- 라이브러리: `scripts/lib/{dca-plan,exit-rules,portfolio,backtest-engine,backtest-aggregate,scoring,theme-aggregate,theme-select,valuation,horizon,history-store,market-comment,reason-template}.mjs`
- 데이터: `src/data/{backtest,picks,portfolio,watchlist,themes}.json`
- 문서: `HANDOFF.md`
- spec 8개 → `docs/superpowers/archive/` 이동

---

## 결정 사항 (스펙에서 모호했던 부분 확정)

1. **regime 라벨**: 기존 `scoreRegime` 의 `score` 정수값을 그대로 라벨로 매핑.
   - `score ≥ 2` → `'bull'`
   - `-1 ≤ score ≤ 1` → `'neutral'`
   - `score ≤ -2` → `'bear'`
2. **VIX 구간**: VIX 가 없는 시장(KR)은 `vol20` 기반.
   - VIX 있을 때: `vix < 15` → `'low'`, `15 ≤ vix < 25` → `'mid'`, `vix ≥ 25` → `'high'`
   - VIX 없을 때(KR): `vol20 < 0.15` → `'low'`, `vol20 < 0.30` → `'mid'`, else → `'high'`
3. **종목 universe**: 기존 `scripts/universe-{kr,us}.json` 의 60개로 MVP 시작. KRX/Nasdaq 풀 리스트 확장은 향후 별도 plan.
4. **백필 기간**: 5년(`range=5y`).
5. **차트 인입 라이브러리**: Chart.js v4 (CDN, 클라이언트 사이드 lazy 로드).

---

# Phase 1 — 인프라

## Task 1: Turso DB 프로비저닝 + 의존성

**Files:**
- Modify: `package.json`
- Create: `.env.local.example`
- Modify: `.gitignore` (이미 `.env*` 포함이면 스킵)

- [ ] **Step 1: 사용자가 직접 Turso 가입 + DB 생성**

[turso.tech](https://turso.tech) 가입 후 무료 plan. CLI 설치 또는 웹 콘솔에서:
- DB 이름: `surgepick`
- 위치: `nrt` (Tokyo, KR/JP 사용자에게 가까움)
- 생성 후 두 값 발급:
  - `Database URL`: `libsql://surgepick-<org>.turso.io`
  - `Auth Token`: (turso db tokens create 또는 콘솔)

이 두 값을 `.env.local` 에 저장 (Step 3).

- [ ] **Step 2: `@libsql/client` 의존성 추가**

```bash
npm install @libsql/client
```

`package.json` dependencies 에 `"@libsql/client": "^0.14.0"` (또는 최신) 추가 확인.

- [ ] **Step 3: `.env.local.example` 작성 + 본인 `.env.local` 채우기**

`.env.local.example` 생성:

```
# Turso libSQL
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=eyJ...
```

본인 `.env.local` 도 같은 파일명으로 실제 값 채워서 저장 (gitignore 됨).

- [ ] **Step 4: Vercel 환경변수 등록**

Vercel 대시보드 → surgepick 프로젝트 → Settings → Environment Variables 에 동일한 두 키 등록 (Production + Preview + Development 모두).

- [ ] **Step 5: GitHub Actions 시크릿 등록**

GitHub → 리포 → Settings → Secrets and variables → Actions → New repository secret 로 두 키 등록.

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json .env.local.example
git commit -m "chore: add @libsql/client + Turso env template"
```

---

## Task 2: DB 스키마 + 적용 스크립트

**Files:**
- Create: `scripts/db/schema.sql`
- Create: `scripts/db/apply-schema.mjs`
- Create: `scripts/lib/db.mjs`

- [ ] **Step 1: `scripts/lib/db.mjs` (libsql 클라이언트 wrapper)**

```js
import { createClient } from '@libsql/client';
import 'dotenv/config';

let cached;
export function getDb() {
  if (cached) return cached;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL not set');
  cached = createClient({ url, authToken });
  return cached;
}
```

`dotenv/config` 사용을 위해 `npm install dotenv` 도 함께 (이미 있으면 스킵).

- [ ] **Step 2: `scripts/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS tickers (
  ticker    TEXT PRIMARY KEY,
  name_kr   TEXT,
  name_en   TEXT,
  market    TEXT NOT NULL,
  exchange  TEXT,
  active    INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tickers_name_kr ON tickers(name_kr);
CREATE INDEX IF NOT EXISTS idx_tickers_name_en ON tickers(name_en);
CREATE INDEX IF NOT EXISTS idx_tickers_market ON tickers(market);

CREATE TABLE IF NOT EXISTS prices (
  ticker    TEXT NOT NULL,
  date      TEXT NOT NULL,
  open      REAL NOT NULL,
  close     REAL NOT NULL,
  high      REAL,
  low       REAL,
  PRIMARY KEY (ticker, date)
);
CREATE INDEX IF NOT EXISTS idx_prices_date ON prices(date);

CREATE TABLE IF NOT EXISTS regime (
  date      TEXT NOT NULL,
  market    TEXT NOT NULL,
  label     TEXT NOT NULL,
  vix       REAL,
  vix_band  TEXT,
  PRIMARY KEY (date, market)
);
CREATE INDEX IF NOT EXISTS idx_regime_lookup ON regime(market, label, vix_band);
```

- [ ] **Step 3: `scripts/db/apply-schema.mjs`**

```js
import { readFileSync } from 'node:fs';
import { getDb } from '../lib/db.mjs';

const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const db = getDb();

// SQLite는 멀티스테이트먼트 batch 가 ; 단위 split 필요
const statements = sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
for (const stmt of statements) {
  console.log('>>', stmt.split('\n')[0]);
  await db.execute(stmt);
}
console.log(`✓ ${statements.length} statements applied`);
```

- [ ] **Step 4: 스키마 적용 실행**

```bash
node scripts/db/apply-schema.mjs
```

기대 출력:

```
>> CREATE TABLE IF NOT EXISTS tickers (...
>> CREATE INDEX IF NOT EXISTS idx_tickers_name_kr ON tickers(name_kr)
...
✓ 10 statements applied
```

Turso 웹 콘솔의 Data Studio 에서 3 테이블 생긴 거 확인.

- [ ] **Step 5: 커밋**

```bash
git add scripts/db/schema.sql scripts/db/apply-schema.mjs scripts/lib/db.mjs package.json package-lock.json
git commit -m "feat(db): turso schema + apply script + libsql wrapper"
```

---

## Task 3: Astro hybrid 모드 + 서버 라이브러리

**Files:**
- Modify: `astro.config.mjs`
- Create: `src/lib/db.mjs`

- [ ] **Step 1: Vercel adapter serverless 로 교체**

```bash
npm uninstall @astrojs/vercel
npm install @astrojs/vercel
```

(`@astrojs/vercel` 패키지 자체가 multiple sub-export 를 가짐 — 임포트 경로만 바꾸면 됨. 의존성은 동일.)

- [ ] **Step 2: `astro.config.mjs` 변경**

```js
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel/serverless';

export default defineConfig({
  output: 'hybrid',
  adapter: vercel(),
  integrations: [tailwind()],
  site: 'https://surgepick.vercel.app',
});
```

기존 페이지들은 정적이어야 하므로 각 페이지 frontmatter 상단에 `export const prerender = true;` 추가 (Task 12 에서 sim.astro 만 false). 우선 `index.astro` 에만 추가:

```astro
---
export const prerender = true;
// 기존 코드...
---
```

- [ ] **Step 3: `src/lib/db.mjs` (서버 라우트용)**

```js
import { createClient } from '@libsql/client';

let cached;
export function getDb() {
  if (cached) return cached;
  const url = import.meta.env.TURSO_DATABASE_URL;
  const authToken = import.meta.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL not set in Astro env');
  cached = createClient({ url, authToken });
  return cached;
}
```

- [ ] **Step 4: 빌드로 hybrid 동작 확인**

```bash
npm run build
```

기대: `dist/` 가 만들어지고 에러 없음. `dist/_functions/` 또는 `.vercel/output/functions/` 디렉토리가 빈 상태로 생성 (API 라우트가 아직 없으므로).

- [ ] **Step 5: 기존 페이지 dev 확인**

```bash
npm run dev
```

`http://localhost:4321/` 가 정상 렌더링되는지 (CWC v2 시장 페이지) 확인 후 Ctrl-C.

- [ ] **Step 6: 커밋**

```bash
git add astro.config.mjs src/lib/db.mjs src/pages/index.astro package.json package-lock.json
git commit -m "chore(astro): switch to hybrid output + serverless adapter"
```

---

# Phase 2 — Ingest 파이프라인

## Task 4: tickers ingest (universe JSON → DB)

**Files:**
- Create: `scripts/ingest-tickers.mjs`

기존 `scripts/universe-kr.json` 의 ticker 는 `005930.KS` 형식, `universe-us.json` 은 `AAPL` 형식. DB 의 `ticker` 컬럼은 통일된 키로 저장 — Yahoo Finance 호환을 위해 **그대로** 저장 (`005930.KS`, `AAPL`). 사용자에게 보일 때만 KR 종목은 앞 6자리만 표시.

- [ ] **Step 1: `scripts/ingest-tickers.mjs`**

```js
import { readFileSync } from 'node:fs';
import { getDb } from './lib/db.mjs';

const kr = JSON.parse(readFileSync(new URL('./universe-kr.json', import.meta.url), 'utf8'));
const us = JSON.parse(readFileSync(new URL('./universe-us.json', import.meta.url), 'utf8'));

const rows = [
  ...kr.map((t) => ({
    ticker: t.ticker,                 // '005930.KS'
    name_kr: t.name,                  // '삼성전자'
    name_en: null,
    market: 'KR',
    exchange: t.market,               // 'KOSPI' | 'KOSDAQ'
  })),
  ...us.map((t) => ({
    ticker: t.ticker,                 // 'AAPL'
    name_kr: null,
    name_en: t.name,                  // 'Apple'
    market: 'US',
    exchange: t.market,               // 'NYSE' | 'NASDAQ'
  })),
];

const db = getDb();
let inserted = 0;
for (const r of rows) {
  await db.execute({
    sql: `INSERT OR REPLACE INTO tickers (ticker, name_kr, name_en, market, exchange, active)
          VALUES (?, ?, ?, ?, ?, 1)`,
    args: [r.ticker, r.name_kr, r.name_en, r.market, r.exchange],
  });
  inserted++;
}
console.log(`✓ ${inserted} tickers upserted`);
```

- [ ] **Step 2: 실행**

```bash
node scripts/ingest-tickers.mjs
```

기대 출력: `✓ 60 tickers upserted`.

Turso Data Studio 에서 `SELECT COUNT(*) FROM tickers` = 60 확인.

- [ ] **Step 3: 커밋**

```bash
git add scripts/ingest-tickers.mjs
git commit -m "feat(ingest): seed tickers from universe JSON"
```

---

## Task 5: Yahoo fetch 에 open 필드 추가

**Files:**
- Modify: `scripts/fetch-yahoo.mjs`

기존 `parseChartResult` 는 close/high/low/volume 만 추출. open 필드 추가.

- [ ] **Step 1: `parseChartResult` 수정**

`scripts/fetch-yahoo.mjs:20-56` 에서:

```js
// 추가
const rawOpens = q.open ?? [];

// for 루프 안에 추가
opens.push(rawOpens[i] ?? rawCloses[i]);

// return 에 추가
opens,
```

전체 변경 후 함수:

```js
export function parseChartResult(result) {
  if (!result) return null;
  const meta = result.meta ?? {};
  const q = result.indicators?.quote?.[0] ?? {};
  const ts = result.timestamp ?? [];

  const rawCloses = q.close ?? [];
  const rawOpens = q.open ?? [];
  const rawVolumes = q.volume ?? [];
  const rawHighs = q.high ?? [];
  const rawLows = q.low ?? [];

  const dates = [];
  const opens = [];
  const closes = [];
  const volumes = [];
  const highs = [];
  const lows = [];

  for (let i = 0; i < rawCloses.length; i++) {
    if (rawCloses[i] == null) continue;
    const t = ts[i];
    if (t == null) continue;
    const d = new Date(t * 1000);
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    dates.push(dateStr);
    opens.push(rawOpens[i] ?? rawCloses[i]);
    closes.push(rawCloses[i]);
    volumes.push(rawVolumes[i] ?? 0);
    highs.push(rawHighs[i] ?? rawCloses[i]);
    lows.push(rawLows[i] ?? rawCloses[i]);
  }
  if (closes.length === 0) return null;

  return {
    dates, opens, closes, volumes, highs, lows,
    meta: {
      price: meta.regularMarketPrice ?? closes[closes.length - 1],
      currency: meta.currency ?? null,
      exchange: meta.exchangeName ?? null,
    },
  };
}
```

- [ ] **Step 2: 회귀 검증 — 기존 scan-regime 동작 확인**

```bash
npm run scan:regime
```

기대: 정상 종료, `src/data/regime.json` 정상 생성. (opens 추가만 했으니 회귀 없음.)

- [ ] **Step 3: 커밋**

```bash
git add scripts/fetch-yahoo.mjs
git commit -m "feat(yahoo): include open prices in chart parser"
```

---

## Task 6: 가격 backfill (5년 일괄)

**Files:**
- Create: `scripts/backfill-prices.mjs`

- [ ] **Step 1: `scripts/backfill-prices.mjs`**

```js
import { fetchChart } from './fetch-yahoo.mjs';
import { getDb } from './lib/db.mjs';

const db = getDb();
const tickers = await db.execute(`SELECT ticker FROM tickers WHERE active = 1`);
const list = tickers.rows.map((r) => r.ticker);

console.log(`backfilling ${list.length} tickers (5y)...`);

let ok = 0, fail = 0, totalRows = 0;
for (let i = 0; i < list.length; i++) {
  const t = list[i];
  const data = await fetchChart(t, '5y');
  if (!data || !data.dates?.length) {
    fail++;
    console.warn(`[${i + 1}/${list.length}] ${t}: no data`);
    await sleep(200);
    continue;
  }
  // 배치 트랜잭션으로 upsert (1000 rows 단위)
  const stmts = [];
  for (let j = 0; j < data.dates.length; j++) {
    stmts.push({
      sql: `INSERT OR REPLACE INTO prices (ticker, date, open, close, high, low)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [t, data.dates[j], data.opens[j], data.closes[j], data.highs[j], data.lows[j]],
    });
  }
  // libsql batch는 최대 N개 statement 지원, 안전하게 500개씩
  for (let k = 0; k < stmts.length; k += 500) {
    await db.batch(stmts.slice(k, k + 500), 'write');
  }
  ok++;
  totalRows += data.dates.length;
  if ((i + 1) % 5 === 0) console.log(`[${i + 1}/${list.length}] ok=${ok} fail=${fail} rows=${totalRows}`);
  await sleep(200);
}
console.log(`done. ok=${ok} fail=${fail} total_rows=${totalRows}`);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
```

- [ ] **Step 2: 실행 (대기 ~15분)**

```bash
node scripts/backfill-prices.mjs
```

기대 출력:

```
backfilling 60 tickers (5y)...
[5/60] ok=5 fail=0 rows=6300
...
done. ok=60 fail=0 total_rows=~75000
```

Turso Data Studio 에서 `SELECT COUNT(*) FROM prices` ≈ 75,000 (60 × 1,250) 확인.

- [ ] **Step 3: 커밋**

```bash
git add scripts/backfill-prices.mjs
git commit -m "feat(ingest): 5y price backfill from Yahoo"
```

---

## Task 7: 일일 가격 increment

**Files:**
- Create: `scripts/ingest-prices.mjs`

- [ ] **Step 1: `scripts/ingest-prices.mjs`**

```js
import { fetchChart } from './fetch-yahoo.mjs';
import { getDb } from './lib/db.mjs';

const db = getDb();
const tickers = await db.execute(`SELECT ticker FROM tickers WHERE active = 1`);
const list = tickers.rows.map((r) => r.ticker);

console.log(`incremental ingest: ${list.length} tickers (1mo, dedup)`);

let ok = 0, fail = 0, inserted = 0;
for (let i = 0; i < list.length; i++) {
  const t = list[i];
  const data = await fetchChart(t, '1mo');
  if (!data || !data.dates?.length) {
    fail++;
    await sleep(200);
    continue;
  }
  const stmts = data.dates.map((d, j) => ({
    sql: `INSERT OR IGNORE INTO prices (ticker, date, open, close, high, low) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [t, d, data.opens[j], data.closes[j], data.highs[j], data.lows[j]],
  }));
  const res = await db.batch(stmts, 'write');
  const newRows = res.reduce((acc, r) => acc + (r.rowsAffected ?? 0), 0);
  inserted += newRows;
  ok++;
  await sleep(150);
}
console.log(`done. ok=${ok} fail=${fail} new_rows=${inserted}`);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
```

`1mo` 범위로 받아오면 backfill 후 매일 실행해도 중복 row 는 `INSERT OR IGNORE` 로 무시됨.

- [ ] **Step 2: 실행 (검증)**

```bash
node scripts/ingest-prices.mjs
```

backfill 직후 실행하면 새 row 거의 0 (당일 데이터만 다를 수 있음):

```
done. ok=60 fail=0 new_rows=0~60
```

- [ ] **Step 3: 커밋**

```bash
git add scripts/ingest-prices.mjs
git commit -m "feat(ingest): daily incremental price update"
```

---

## Task 8: regime ingest (regime.json → DB)

**Files:**
- Create: `scripts/ingest-regime.mjs`

기존 `scan-regime.mjs` 가 `src/data/regime.json` 에 markets[].score, fearGauge.vix 를 저장하지만 **그날의 일별 데이터 한 줄** 뿐임. 과거 5년치 일별 regime 을 채우려면 backfill 도 필요. 일단 매일 한 줄씩 누적 + 초기 backfill 은 후속 step 에서.

스펙의 score → 라벨 매핑:
- score ≥ 2 → bull
- -1 ≤ score ≤ 1 → neutral
- score ≤ -2 → bear

VIX band:
- vix < 15: low / 15 ≤ vix < 25: mid / vix ≥ 25: high
- KR (vix=null): vol20 < 0.15: low / vol20 < 0.30: mid / else: high

scan-regime 의 closes60 + vol20 metrics 가 markets[].closes60 에 있지만 vol20 는 metrics 객체에 안 들어 있으므로 ingest 시 다시 계산.

- [ ] **Step 1: `scripts/ingest-regime.mjs`**

```js
import { readFileSync } from 'node:fs';
import { getDb } from './lib/db.mjs';
import { stdev } from './lib/stats.mjs';

const regime = JSON.parse(readFileSync(new URL('../src/data/regime.json', import.meta.url), 'utf8'));
const date = regime.asOf.slice(0, 10);   // 'YYYY-MM-DD'
const vix = regime.fearGauge?.vix ?? null;

function vixBand({ vix, vol20 }) {
  if (vix != null) {
    if (vix < 15) return 'low';
    if (vix < 25) return 'mid';
    return 'high';
  }
  if (vol20 == null) return null;
  if (vol20 < 0.15) return 'low';
  if (vol20 < 0.30) return 'mid';
  return 'high';
}

function labelFromScore(score) {
  if (score >= 2) return 'bull';
  if (score <= -2) return 'bear';
  return 'neutral';
}

function computeVol20(closes60) {
  if (!closes60 || closes60.length < 21) return null;
  const last20 = closes60.slice(-21);
  const rets = [];
  for (let i = 1; i < last20.length; i++) rets.push((last20[i] - last20[i - 1]) / last20[i - 1]);
  return stdev(rets) * Math.sqrt(252);
}

const db = getDb();
const stmts = [];

for (const m of regime.markets ?? []) {
  // KOSPI/KOSDAQ → KR, SPX/NDX → US
  const marketCode = ['KOSPI', 'KOSDAQ'].includes(m.code) ? 'KR' : 'US';
  const vol20 = computeVol20(m.closes60);
  const vixForMarket = marketCode === 'US' ? vix : null;
  const band = vixBand({ vix: vixForMarket, vol20 });
  const label = labelFromScore(m.score);
  stmts.push({
    sql: `INSERT OR REPLACE INTO regime (date, market, label, vix, vix_band) VALUES (?, ?, ?, ?, ?)`,
    args: [date, marketCode, label, vixForMarket, band],
  });
}

// KOSPI/KOSDAQ 둘 다 KR이라 같은 row 가 두 번 INSERT 되므로 마지막 것만 남음.
// 대표값으로 KOSPI 만 사용하도록 dedupe:
const seen = new Set();
const dedup = stmts.filter((s) => {
  const key = `${s.args[0]}::${s.args[1]}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

await db.batch(dedup, 'write');
console.log(`✓ regime ingested for ${date}: ${dedup.length} markets`);
```

- [ ] **Step 2: 실행**

```bash
npm run scan:regime && node scripts/ingest-regime.mjs
```

기대 출력:

```
✓ regime ingested for 2026-05-28: 2 markets
```

Turso Data Studio 에서 `SELECT * FROM regime` 확인 — 2 행 (KR, US).

- [ ] **Step 3: 과거 backfill 노트 (별도 task 4 후 plan 외)**

regime 은 매일 한 줄씩 누적되어 5년 데이터가 모이려면 5년 운영 필요. case 매칭 표본 부족 문제. **임시 대안**: backfill-prices 결과 (KOSPI/SPX 지수 일별 close) + 같은 알고리즘으로 과거 5년 일별 regime 재구성. 이걸 plan 외 별도 보조 task 로 두자 — Task 11 의 predict 가 작동하면서 "표본 부족" 라벨이 자주 뜨면 그때 추가.

- [ ] **Step 4: 커밋**

```bash
git add scripts/ingest-regime.mjs
git commit -m "feat(ingest): daily regime → DB with label/vix_band mapping"
```

---

## Task 9: 자동완성 인덱스 빌드 + GH Actions 갱신

**Files:**
- Create: `scripts/build-tickers-index.mjs`
- Modify: `package.json` (`scripts.build` 에 prebuild step 추가, scripts 정리)
- Modify: `.github/workflows/scan.yml`

- [ ] **Step 1: `scripts/build-tickers-index.mjs`**

```js
import { writeFileSync, mkdirSync } from 'node:fs';
import { getDb } from './lib/db.mjs';

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
writeFileSync(new URL('../public/tickers-index.json', import.meta.url), JSON.stringify(out));
console.log(`✓ wrote public/tickers-index.json (${out.length} tickers)`);
```

- [ ] **Step 2: `package.json` scripts 갱신**

기존 `backtest`, `scan:picks`, `scan:themes`, `tune:vix` 는 Phase 6 에서 삭제하지만 우선 그대로 둠. 신규 scripts 추가:

```json
"scripts": {
  "dev": "astro dev",
  "build": "node scripts/build-tickers-index.mjs && astro build",
  "preview": "astro preview",
  "scan:regime": "node scripts/scan-regime.mjs",
  "ingest:regime": "node scripts/ingest-regime.mjs",
  "ingest:prices": "node scripts/ingest-prices.mjs",
  "ingest:tickers": "node scripts/ingest-tickers.mjs",
  "backfill:prices": "node scripts/backfill-prices.mjs",
  "build:index": "node scripts/build-tickers-index.mjs",
  "scan:picks": "node scripts/scan-picks.mjs",
  "scan:themes": "node scripts/scan-themes.mjs",
  "scan": "npm run scan:regime && npm run ingest:regime && npm run ingest:prices",
  "backtest": "node scripts/backtest.mjs",
  "tune:vix": "node scripts/tune-vix.mjs",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

(Phase 6 에서 `scan:picks`, `scan:themes`, `backtest`, `tune:vix` 제거)

- [ ] **Step 3: 빌드 인덱스 생성 검증**

```bash
npm run build:index
```

기대: `public/tickers-index.json` 생성, 사이즈 ~5 KB.

- [ ] **Step 4: GitHub Actions workflow 수정**

`.github/workflows/scan.yml` 의 `Run scan` step 을 `Run scan + ingest` 로 갱신. 시크릿 env 추가.

```yaml
- name: Run scan + ingest
  env:
    TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
    TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
  run: npm run scan
```

(기존 workflow 의 다른 step 들은 그대로 유지 — JSON 파일 commit 부분도 일단 둠. Phase 6 에서 제거.)

- [ ] **Step 5: 커밋**

```bash
git add scripts/build-tickers-index.mjs package.json package-lock.json .github/workflows/scan.yml public/tickers-index.json
git commit -m "feat(build): tickers index + ingest pipeline in scan workflow"
```

---

# Phase 3 — 핵심 로직 (TDD)

## Task 10: autocomplete 검색 라이브러리

**Files:**
- Create: `src/lib/autocomplete.mjs`
- Create: `src/lib/autocomplete.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/autocomplete.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { search } from './autocomplete.mjs';

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
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm test src/lib/autocomplete.test.ts
```

기대: 모든 케이스 FAIL (import 에러).

- [ ] **Step 3: `src/lib/autocomplete.mjs` 작성**

```js
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
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test src/lib/autocomplete.test.ts
```

기대: 7/7 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/autocomplete.mjs src/lib/autocomplete.test.ts
git commit -m "feat(lib): autocomplete prefix/substring search with priority"
```

---

## Task 11: case-based 예측 라이브러리

**Files:**
- Create: `src/lib/predict.mjs`
- Create: `src/lib/predict.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (5개 케이스)**

`src/lib/predict.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchCases, normalizeTrajectory, aggregateBands, predict } from './predict.mjs';

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
    expect(r).toEqual([0, 0.1, 0.21]);
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
    const r = predict({ prices, regime: limitedRegime, ctx: { market: 'US', label: 'bull', vix_band: 'low' }, today: '2024-06-01', horizon: 5 });
    expect(r.case_count).toBeGreaterThan(0);
    expect(r.fallback).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm test src/lib/predict.test.ts
```

기대: 전부 FAIL (import 에러).

- [ ] **Step 3: `src/lib/predict.mjs` 작성**

```js
/**
 * 시장 컨텍스트가 일치하는 과거 일자들을 찾아 반환.
 * case_date + horizon > today 인 일자는 오버랩 방지로 제외.
 *
 * @param {Array} regimeRows  - {date, market, label, vix_band}[]
 * @param {{market, label, vix_band}} ctx
 * @param {string} today      - 'YYYY-MM-DD'
 * @param {number} horizon    - calendar days
 * @returns {Array} 매칭된 regime row, 최신순
 */
export function matchCases(regimeRows, ctx, today, horizon) {
  const cutoff = addDays(today, -horizon);   // case_date < cutoff 면 +horizon 까지도 today 이전
  return regimeRows
    .filter(
      (r) =>
        r.market === ctx.market &&
        r.label === ctx.label &&
        r.vix_band === ctx.vix_band &&
        r.date <= cutoff,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * case_date 의 close 를 기준으로 정규화된 일별 수익률 궤적.
 * @param {Array<{date:string, close:number}>} prices  - 정렬 무관
 * @param {string} caseDate
 * @param {number} horizon
 * @returns {number[]|null}  길이 horizon+1, 결측 일자는 null
 */
export function normalizeTrajectory(prices, caseDate, horizon) {
  const byDate = new Map(prices.map((p) => [p.date, p.close]));
  const c0 = byDate.get(caseDate);
  if (c0 == null) return null;
  const out = [0];
  for (let d = 1; d <= horizon; d++) {
    const target = addDays(caseDate, d);
    const c = byDate.get(target);
    out.push(c == null ? null : c / c0 - 1);
  }
  return out;
}

/**
 * 여러 trajectory 를 d 별 percentile 로 집계.
 * @param {Array<Array<number|null>>} trajectories
 * @param {number} horizon
 * @returns {Array<{d:number, p25:number, p50:number, p75:number}>}
 */
export function aggregateBands(trajectories, horizon) {
  const out = [];
  for (let d = 0; d <= horizon; d++) {
    const vals = trajectories.map((t) => t[d]).filter((v) => v != null && !Number.isNaN(v));
    vals.sort((a, b) => a - b);
    out.push({
      d,
      p25: quantile(vals, 0.25),
      p50: quantile(vals, 0.50),
      p75: quantile(vals, 0.75),
    });
  }
  return out;
}

/**
 * 최종 예측: 점진 fallback (vix_band drop → label only).
 *
 * @param {Object} args
 * @param {Array<{date:string, close:number}>} args.prices
 * @param {Array} args.regime
 * @param {{market, label, vix_band}} args.ctx
 * @param {string} args.today
 * @param {number} args.horizon
 * @returns {{
 *   forecast: Array<{d:number, date:string, median:number, lo:number, hi:number}>,
 *   case_count: number,
 *   fallback: boolean,
 *   error?: string
 * }}
 */
export function predict({ prices, regime, ctx, today, horizon }) {
  const byDate = new Map(prices.map((p) => [p.date, p.close]));
  const todayClose = byDate.get(today);
  if (todayClose == null) return { forecast: [], case_count: 0, fallback: false, error: 'no_today_close' };

  let cases = matchCases(regime, ctx, today, horizon);
  let fallback = false;
  if (cases.length < 10) {
    cases = matchCases(regime, { ...ctx, vix_band: undefined }, today, horizon)
      .filter((r) => r.market === ctx.market && r.label === ctx.label);
    fallback = true;
  }
  if (cases.length < 5) {
    return { forecast: [], case_count: cases.length, fallback, error: 'insufficient_cases' };
  }

  const trajectories = cases
    .map((c) => normalizeTrajectory(prices, c.date, horizon))
    .filter((t) => t != null);

  if (trajectories.length < 5) {
    return { forecast: [], case_count: trajectories.length, fallback, error: 'insufficient_trajectories' };
  }

  const bands = aggregateBands(trajectories, horizon);
  const forecast = bands.map((b) => ({
    d: b.d,
    date: addDays(today, b.d),
    median: todayClose * (1 + b.p50),
    lo: todayClose * (1 + b.p25),
    hi: todayClose * (1 + b.p75),
  }));

  return { forecast, case_count: trajectories.length, fallback };
}

// ---- helpers ----

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] != null) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test src/lib/predict.test.ts
```

기대: 전부 PASS.

(만약 `matchCases` "오버랩 윈도우 제외" 테스트가 실패하면 `cutoff` 계산 + 비교 부등호를 점검 — `case_date + horizon ≤ today` 가 되도록 `case_date ≤ today - horizon`)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/predict.mjs src/lib/predict.test.ts
git commit -m "feat(lib): case-based predict with percentile bands + fallback"
```

---

# Phase 4 — UI

## Task 12: sim 페이지 스캐폴드 + 네비

**Files:**
- Create: `src/pages/sim.astro`
- Modify: `src/layouts/Base.astro`

- [ ] **Step 1: `src/layouts/Base.astro` 에 네비 추가**

`src/layouts/Base.astro:22-25` 를 다음으로 교체:

```astro
<header class="px-4 pt-6 pb-2 max-w-screen-md mx-auto">
  <div class="flex items-baseline justify-between">
    <a href="/" class="text-2xl font-bold tracking-tight">surgePick</a>
    {asOfText && <span class="text-xs text-slate-400">{asOfText} 기준</span>}
  </div>
  <nav class="mt-3 flex gap-4 text-sm border-b border-slate-800">
    <a href="/" class="pb-2 border-b-2 border-transparent hover:border-slate-500" data-nav="market">시장</a>
    <a href="/sim" class="pb-2 border-b-2 border-transparent hover:border-slate-500" data-nav="sim">종목 시뮬레이션</a>
  </nav>
</header>
```

(현재 페이지 강조는 client script 로 처리하거나 Astro `Astro.url.pathname` 으로 server 측 비교 — 우선 hover 로만 유지.)

- [ ] **Step 2: `src/pages/sim.astro` 스캐폴드**

```astro
---
import Base from '../layouts/Base.astro';
export const prerender = false;   // SSR for API context (next steps)
---
<Base title="surgePick — 종목 시뮬레이션">
  <section class="space-y-4">
    <h1 class="text-xl font-bold">종목 시뮬레이션</h1>
    <p class="text-sm text-slate-400">
      종목 하나를 선택하면 과거 차트 + 과거 유사 시장 사례 평균에 기반한 1·2·3개월 예측선을 그립니다.
    </p>
    <div id="ticker-search-root"></div>
    <div id="sim-result" class="hidden space-y-4"></div>
  </section>
</Base>
```

- [ ] **Step 3: dev 서버에서 페이지 렌더링 확인**

```bash
npm run dev
```

브라우저에서 `http://localhost:4321/sim` 접속 → "종목 시뮬레이션" 헤더 + 안내 문구 보이는지 확인. 네비 (시장 / 종목 시뮬레이션) 두 링크 모두 동작.

Ctrl-C 로 종료.

- [ ] **Step 4: 커밋**

```bash
git add src/pages/sim.astro src/layouts/Base.astro
git commit -m "feat(ui): /sim page scaffold + nav"
```

---

## Task 13: `/api/search` 라우트

**Files:**
- Create: `src/pages/api/search.ts`

자동완성 인덱스는 정적 자산(`/tickers-index.json`) 으로 충분하지만, 라우트도 fallback 으로 만들어둠. 클라이언트는 우선 정적 인덱스로 동작.

- [ ] **Step 1: `src/pages/api/search.ts`**

```ts
import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db.mjs';
import { search } from '../../lib/autocomplete.mjs';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q') ?? '';
  if (!q.trim()) return new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } });

  const db = getDb();
  const res = await db.execute(`SELECT ticker, name_kr, name_en, market, exchange FROM tickers WHERE active = 1`);
  const matches = search(res.rows, q, 20);
  return new Response(JSON.stringify(matches), { headers: { 'content-type': 'application/json' } });
};
```

- [ ] **Step 2: dev 에서 호출 검증**

```bash
npm run dev
```

다른 터미널에서:

```bash
curl 'http://localhost:4321/api/search?q=samsung'
```

기대: `[]` (universe 에 "Samsung" 이름은 한국어로만 있음). 다음:

```bash
curl 'http://localhost:4321/api/search?q=apple'
```

기대: `[{"ticker":"AAPL","name_en":"Apple",...}]`

```bash
curl 'http://localhost:4321/api/search?q=%EC%82%BC%EC%84%B1'   # '삼성'
```

기대: `[{"ticker":"005930.KS","name_kr":"삼성전자",...}, ...]`

Ctrl-C.

- [ ] **Step 3: 커밋**

```bash
git add src/pages/api/search.ts
git commit -m "feat(api): /api/search SSR fallback for autocomplete"
```

---

## Task 14: `/api/ticker` 라우트

**Files:**
- Create: `src/pages/api/ticker.ts`

- [ ] **Step 1: `src/pages/api/ticker.ts`**

```ts
import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db.mjs';
import { predict } from '../../lib/predict.mjs';

export const prerender = false;

const HORIZON_TO_HISTORY = { 30: 60, 60: 90, 90: 120 } as const;

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id');
  const horizon = Number(url.searchParams.get('horizon') ?? 30);
  if (!id) return jsonErr(400, 'missing_id');
  if (![30, 60, 90].includes(horizon)) return jsonErr(400, 'invalid_horizon');

  const db = getDb();

  // ticker meta
  const tk = await db.execute({
    sql: `SELECT ticker, name_kr, name_en, market, exchange FROM tickers WHERE ticker = ? LIMIT 1`,
    args: [id],
  });
  if (tk.rows.length === 0) return jsonErr(404, 'ticker_not_found');
  const ticker = tk.rows[0];

  // 과거 prices: 5년 (case 매칭용) + 표시용 최근 N일
  const pricesRes = await db.execute({
    sql: `SELECT date, open, close, high, low FROM prices WHERE ticker = ? ORDER BY date ASC`,
    args: [id],
  });
  const prices = pricesRes.rows.map((r) => ({
    date: r.date as string,
    open: r.open as number,
    close: r.close as number,
    high: r.high as number | null,
    low: r.low as number | null,
  }));
  if (prices.length === 0) return jsonErr(404, 'no_prices');

  const today = prices[prices.length - 1].date;
  const todayClose = prices[prices.length - 1].close;

  // 시장 컨텍스트 (today)
  const regNow = await db.execute({
    sql: `SELECT label, vix, vix_band FROM regime WHERE market = ? AND date <= ? ORDER BY date DESC LIMIT 1`,
    args: [ticker.market, today],
  });
  if (regNow.rows.length === 0) return jsonErr(404, 'no_regime');
  const ctx = {
    market: ticker.market as string,
    label: regNow.rows[0].label as string,
    vix_band: regNow.rows[0].vix_band as string,
  };

  // 전체 regime (case 매칭용)
  const regAll = await db.execute({
    sql: `SELECT date, market, label, vix_band FROM regime WHERE market = ? ORDER BY date ASC`,
    args: [ticker.market],
  });
  const regimeRows = regAll.rows.map((r) => ({
    date: r.date as string,
    market: r.market as string,
    label: r.label as string,
    vix_band: r.vix_band as string,
  }));

  // 예측
  const { forecast, case_count, fallback, error } = predict({
    prices,
    regime: regimeRows,
    ctx,
    today,
    horizon,
  });

  // 표시용 최근 가격 (과거 N일)
  const historyDays = HORIZON_TO_HISTORY[horizon as 30 | 60 | 90];
  const recent = prices.slice(-historyDays);

  return new Response(
    JSON.stringify({
      ticker,
      today_close: todayClose,
      context: { ...ctx, vix: regNow.rows[0].vix, case_count, fallback, error: error ?? null },
      history: recent,
      forecast,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
};

function jsonErr(status: number, code: string) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
```

- [ ] **Step 2: dev 에서 호출 검증**

```bash
npm run dev
```

```bash
curl 'http://localhost:4321/api/ticker?id=AAPL&horizon=30' | python -m json.tool | head -60
```

기대: `ticker`, `today_close`, `context`, `history` (60개), `forecast` (31개) 가 포함된 JSON.

```bash
curl 'http://localhost:4321/api/ticker?id=005930.KS&horizon=90' | python -m json.tool | head -60
```

기대: KR 종목도 동일 구조. context 부족하면 `error` 채워짐.

- [ ] **Step 3: 커밋**

```bash
git add src/pages/api/ticker.ts
git commit -m "feat(api): /api/ticker SSR with predict bands"
```

---

## Task 15: TickerSearch 컴포넌트 (정적 인덱스 + 키보드 탐색)

**Files:**
- Create: `src/components/TickerSearch.astro`
- Modify: `src/pages/sim.astro` (마운트)

- [ ] **Step 1: `src/components/TickerSearch.astro`**

```astro
---
// Server-side: 아무 prop 없음. 모든 동작은 클라이언트.
---
<div class="ticker-search relative">
  <input
    id="tk-input"
    type="text"
    autocomplete="off"
    spellcheck="false"
    placeholder="종목명 또는 코드 (예: 삼성전자, AAPL)"
    class="w-full px-4 py-3 rounded-lg bg-slate-900 text-slate-100 border border-slate-700 focus:outline-none focus:border-cyan-500"
  />
  <ul
    id="tk-results"
    role="listbox"
    class="hidden absolute z-10 mt-1 w-full max-h-72 overflow-auto rounded-lg bg-slate-900 border border-slate-700 shadow-xl"
  ></ul>
  <button
    id="tk-go"
    type="button"
    disabled
    class="mt-3 w-full py-3 rounded-lg bg-cyan-700 hover:bg-cyan-600 disabled:bg-slate-800 disabled:text-slate-500 font-semibold transition"
  >시뮬레이션 시작</button>
</div>

<script>
  import { search } from '../lib/autocomplete.mjs';

  const input = document.getElementById('tk-input') as HTMLInputElement;
  const results = document.getElementById('tk-results') as HTMLUListElement;
  const goBtn = document.getElementById('tk-go') as HTMLButtonElement;

  type Item = { ticker: string; name_kr: string | null; name_en: string | null; market: 'KR' | 'US'; exchange: string };

  let index: Item[] = [];
  let selected: Item | null = null;
  let highlight = -1;
  let currentMatches: Item[] = [];

  // 인덱스 로드 (한 번)
  fetch('/tickers-index.json').then((r) => r.json()).then((d) => { index = d; });

  function render(matches: Item[]) {
    currentMatches = matches;
    highlight = -1;
    if (matches.length === 0) {
      results.classList.add('hidden');
      return;
    }
    results.innerHTML = matches
      .map((m, i) => {
        const flag = m.market === 'KR' ? '🇰🇷' : '🇺🇸';
        const display = m.name_kr ?? m.name_en ?? m.ticker;
        const short = m.ticker.replace(/\.[A-Z]+$/, '');
        return `<li role="option" data-i="${i}" class="px-4 py-2 cursor-pointer hover:bg-slate-800 flex items-center gap-3">
          <span>${flag}</span>
          <span class="text-slate-400 font-mono text-xs">${short}</span>
          <span class="font-medium">${display}</span>
        </li>`;
      })
      .join('');
    results.classList.remove('hidden');
  }

  function pick(m: Item) {
    selected = m;
    input.value = m.name_kr ?? m.name_en ?? m.ticker;
    results.classList.add('hidden');
    goBtn.disabled = false;
  }

  input.addEventListener('input', () => {
    selected = null;
    goBtn.disabled = true;
    render(search(index, input.value, 8));
  });

  input.addEventListener('keydown', (e) => {
    if (results.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight = Math.min(highlight + 1, currentMatches.length - 1);
      updateHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight = Math.max(highlight - 1, 0);
      updateHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight >= 0) pick(currentMatches[highlight]);
    } else if (e.key === 'Escape') {
      results.classList.add('hidden');
    }
  });

  function updateHighlight() {
    [...results.children].forEach((el, i) => {
      el.classList.toggle('bg-slate-800', i === highlight);
    });
  }

  results.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (!li) return;
    pick(currentMatches[Number(li.dataset.i)]);
  });

  goBtn.addEventListener('click', () => {
    if (!selected) return;
    window.dispatchEvent(new CustomEvent('sim:run', { detail: { ticker: selected } }));
  });
</script>
```

- [ ] **Step 2: `src/pages/sim.astro` 에 마운트**

```astro
---
import Base from '../layouts/Base.astro';
import TickerSearch from '../components/TickerSearch.astro';
export const prerender = false;
---
<Base title="surgePick — 종목 시뮬레이션">
  <section class="space-y-4">
    <h1 class="text-xl font-bold">종목 시뮬레이션</h1>
    <p class="text-sm text-slate-400">
      종목 하나를 선택하면 과거 차트 + 과거 유사 시장 사례 평균에 기반한 1·2·3개월 예측선을 그립니다.
    </p>
    <TickerSearch />
    <div id="sim-result" class="hidden space-y-4"></div>
  </section>
</Base>
```

- [ ] **Step 3: dev 에서 검증**

```bash
npm run dev
```

`/sim` 페이지에서:
- 입력 박스에 "삼성" 입력 → 드롭다운에 삼성전자/삼성SDI 등 표시
- ↓↑ 키로 선택 이동
- Enter 로 선택 → 입력란에 채워지고 버튼 활성화
- 빈 입력 → 드롭다운 사라짐
- Escape → 드롭다운 닫힘

Ctrl-C.

- [ ] **Step 4: 커밋**

```bash
git add src/components/TickerSearch.astro src/pages/sim.astro
git commit -m "feat(ui): TickerSearch with prefix/substring autocomplete + keyboard"
```

---

## Task 16: 결과 영역 컨트롤러 + PriceTable

**Files:**
- Create: `src/components/PriceTable.astro`
- Create: `src/components/SimController.astro`
- Modify: `src/pages/sim.astro`

`SimController` 는 `sim:run` 이벤트 받아서 fetch + 결과 렌더링. 표 영역만 우선 만들고 차트는 Task 17.

- [ ] **Step 1: `src/components/PriceTable.astro` (HTML 템플릿용 빈 컴포넌트)**

PriceTable 은 DOM 만 노출하고 채우기는 SimController 가 함:

```astro
---
---
<div class="price-table-root">
  <header class="flex items-baseline justify-between mb-2">
    <h2 class="text-lg font-semibold" data-pt-title>—</h2>
    <span class="text-xs text-slate-400" data-pt-context>—</span>
  </header>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="text-slate-400 text-left border-b border-slate-800">
        <tr>
          <th class="py-2 pr-4">날짜</th>
          <th class="py-2 pr-4 text-right">시가</th>
          <th class="py-2 pr-4 text-right">종가</th>
          <th class="py-2 text-right">변동</th>
        </tr>
      </thead>
      <tbody data-pt-body></tbody>
    </table>
  </div>
</div>
```

- [ ] **Step 2: `src/components/SimController.astro`**

```astro
---
---
<script>
  type ApiResp = {
    ticker: { ticker: string; name_kr: string|null; name_en: string|null; market: string; exchange: string };
    today_close: number;
    context: { label: string; vix: number|null; vix_band: string; case_count: number; fallback: boolean; error: string|null };
    history: { date: string; open: number; close: number }[];
    forecast: { d: number; date: string; median: number; lo: number; hi: number }[];
  };

  const resultRoot = document.getElementById('sim-result') as HTMLElement;
  let lastSelectedTicker: string | null = null;
  let currentHorizon = 30;

  window.addEventListener('sim:run', async (ev: Event) => {
    const { ticker } = (ev as CustomEvent).detail;
    lastSelectedTicker = ticker.ticker;
    await runAndRender(currentHorizon);
  });

  window.addEventListener('sim:horizon', async (ev: Event) => {
    currentHorizon = (ev as CustomEvent).detail.horizon;
    if (lastSelectedTicker) await runAndRender(currentHorizon);
  });

  async function runAndRender(horizon: number) {
    if (!lastSelectedTicker) return;
    resultRoot.classList.remove('hidden');
    resultRoot.innerHTML = '<p class="text-slate-400 text-sm">로딩 중...</p>';

    const res = await fetch(`/api/ticker?id=${encodeURIComponent(lastSelectedTicker)}&horizon=${horizon}`);
    if (!res.ok) {
      resultRoot.innerHTML = `<p class="text-red-400 text-sm">조회 실패: ${res.status}</p>`;
      return;
    }
    const data: ApiResp = await res.json();

    resultRoot.innerHTML = renderPriceTable(data) + renderChartPlaceholder(horizon);
    fillPriceTable(data);
    // 차트 init 은 Task 17 에서 추가
    window.dispatchEvent(new CustomEvent('sim:rendered', { detail: { data, horizon } }));
  }

  function renderPriceTable(d: ApiResp) {
    return `
      <section class="price-table">
        <header class="flex items-baseline justify-between mb-2">
          <h2 class="text-lg font-semibold" data-pt-title></h2>
          <span class="text-xs text-slate-400" data-pt-context></span>
        </header>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-slate-400 text-left border-b border-slate-800">
              <tr><th class="py-2 pr-4">날짜</th><th class="py-2 pr-4 text-right">시가</th><th class="py-2 pr-4 text-right">종가</th><th class="py-2 text-right">변동</th></tr>
            </thead>
            <tbody data-pt-body></tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderChartPlaceholder(horizon: number) {
    const mTag = (n: number) => `<button data-hz="${n}" class="px-3 py-1 rounded text-sm ${n === horizon ? 'bg-cyan-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}">${n / 30}M</button>`;
    return `
      <section class="forecast-chart space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">예측 차트</h2>
          <div class="flex gap-1">${[30, 60, 90].map(mTag).join('')}</div>
        </div>
        <div class="relative aspect-video bg-slate-900 rounded-lg p-2">
          <canvas id="forecast-canvas"></canvas>
        </div>
      </section>
    `;
  }

  function fillPriceTable(d: ApiResp) {
    const title = resultRoot.querySelector('[data-pt-title]') as HTMLElement;
    const ctxEl = resultRoot.querySelector('[data-pt-context]') as HTMLElement;
    const body = resultRoot.querySelector('[data-pt-body]') as HTMLElement;
    const fmt = (n: number) => n.toLocaleString(d.ticker.market === 'KR' ? 'ko-KR' : 'en-US', { maximumFractionDigits: 2 });
    const currency = d.ticker.market === 'KR' ? '₩' : '$';
    const shortTicker = d.ticker.ticker.replace(/\.[A-Z]+$/, '');
    title.textContent = `${d.ticker.name_kr ?? d.ticker.name_en ?? shortTicker} (${shortTicker}) — ${currency}${fmt(d.today_close)}`;

    const labelKo = { bull: '강세장', neutral: '횡보', bear: '약세장' }[d.context.label] ?? d.context.label;
    const bandKo = { low: '낮음', mid: '보통', high: '높음' }[d.context.vix_band] ?? d.context.vix_band;
    const fb = d.context.fallback ? ' · VIX 폴백' : '';
    const err = d.context.error ? ` · ${d.context.error}` : '';
    ctxEl.textContent = `시장: ${labelKo} · VIX ${bandKo} · 유사 ${d.context.case_count}건${fb}${err}`;

    const last10 = d.history.slice(-10).reverse();
    body.innerHTML = last10
      .map((p, i) => {
        const prev = i === last10.length - 1 ? p.close : last10[i + 1].close;
        const change = ((p.close - prev) / prev) * 100;
        const color = change > 0 ? 'text-red-400' : change < 0 ? 'text-blue-400' : 'text-slate-400';
        return `<tr class="border-b border-slate-900">
          <td class="py-1.5 pr-4 font-mono text-xs">${p.date}</td>
          <td class="py-1.5 pr-4 text-right">${fmt(p.open)}</td>
          <td class="py-1.5 pr-4 text-right font-semibold">${fmt(p.close)}</td>
          <td class="py-1.5 text-right ${color}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</td>
        </tr>`;
      })
      .join('');
  }

  // horizon 토글
  document.body.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-hz]');
    if (!btn) return;
    const hz = Number((btn as HTMLElement).dataset.hz);
    window.dispatchEvent(new CustomEvent('sim:horizon', { detail: { horizon: hz } }));
  });
</script>
```

- [ ] **Step 3: `src/pages/sim.astro` 에 마운트**

```astro
---
import Base from '../layouts/Base.astro';
import TickerSearch from '../components/TickerSearch.astro';
import SimController from '../components/SimController.astro';
export const prerender = false;
---
<Base title="surgePick — 종목 시뮬레이션">
  <section class="space-y-4">
    <h1 class="text-xl font-bold">종목 시뮬레이션</h1>
    <p class="text-sm text-slate-400">
      종목 하나를 선택하면 과거 차트 + 과거 유사 시장 사례 평균에 기반한 1·2·3개월 예측선을 그립니다.
    </p>
    <TickerSearch />
    <div id="sim-result" class="hidden space-y-6"></div>
    <SimController />
  </section>
</Base>
```

- [ ] **Step 4: dev 검증**

```bash
npm run dev
```

`/sim` 에서 AAPL 검색 → 시뮬레이션 시작 → 표가 나오고 차트 placeholder canvas (빈 회색 박스) 노출. 1M/2M/3M 토글 클릭 → 표 변화 (history 길이는 동일하지만 case_count 등은 변할 수 있음).

Ctrl-C.

- [ ] **Step 5: 커밋**

```bash
git add src/components/PriceTable.astro src/components/SimController.astro src/pages/sim.astro
git commit -m "feat(ui): SimController + price table + horizon toggle"
```

---

## Task 17: ForecastChart (Chart.js + 수동 progressive draw)

**Files:**
- Modify: `src/components/SimController.astro` (Chart 통합)
- Modify: `src/layouts/Base.astro` (Chart.js CDN)

Chart.js 는 4.4 버전 CDN 사용 (Astro hybrid 빌드 부담 줄이기 위해 import 대신 글로벌 로드).

- [ ] **Step 1: `Base.astro` 에 Chart.js CDN 추가**

`src/layouts/Base.astro` `</head>` 직전에:

```astro
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" is:inline></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js" is:inline></script>
```

- [ ] **Step 2: `SimController.astro` script 하단에 차트 그리기 함수 추가**

다음을 `SimController.astro` 의 `<script>` 블록 마지막에 추가:

```ts
declare const Chart: any;

let chart: any = null;

window.addEventListener('sim:rendered', (ev: Event) => {
  const { data } = (ev as CustomEvent).detail;
  drawChart(data);
});

function drawChart(data: ApiResp) {
  const canvas = document.getElementById('forecast-canvas') as HTMLCanvasElement;
  if (!canvas) return;
  if (chart) chart.destroy();

  const ctx = canvas.getContext('2d')!;

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: '실제',         data: [], borderColor: '#60a5fa', backgroundColor: 'transparent', borderWidth: 2, fill: false, pointRadius: 0, tension: 0.2 },
        { label: '예측 메디안',  data: [], borderColor: '#22d3ee', backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 4], fill: false, pointRadius: 0, tension: 0.2 },
        { label: '예측 p25-p75', data: [], borderColor: 'transparent', backgroundColor: 'rgba(34,211,238,0.18)', fill: '-1', pointRadius: 0 },
        { label: '_p25 hidden',  data: [], borderColor: 'transparent', backgroundColor: 'transparent', fill: false, pointRadius: 0, showLine: false, hidden: false },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#cbd5e1', filter: (l: any) => !l.text.startsWith('_') } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { type: 'time', time: { unit: 'month' }, ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
      },
    },
  });

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const allPoints = [
    ...data.history.map((p) => ({ date: p.date, isHistory: true, value: p.close })),
    ...data.forecast.slice(1).map((p) => ({ date: p.date, isHistory: false, median: p.median, lo: p.lo, hi: p.hi })),
  ];

  if (reduceMotion) {
    allPoints.forEach((p) => pushPoint(p));
    chart.update('none');
    return;
  }

  const totalMs = 2000;
  const msPerPoint = totalMs / allPoints.length;
  let i = 0;
  let lastTs = performance.now();

  function tick(now: number) {
    while (now - lastTs >= msPerPoint && i < allPoints.length) {
      pushPoint(allPoints[i]);
      i++;
      lastTs += msPerPoint;
    }
    chart.update('none');
    if (i < allPoints.length) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function pushPoint(p: any) {
    chart.data.labels.push(p.date);
    if (p.isHistory) {
      chart.data.datasets[0].data.push(p.value);
      chart.data.datasets[1].data.push(null);
      chart.data.datasets[2].data.push(null);
      chart.data.datasets[3].data.push(null);
    } else {
      chart.data.datasets[0].data.push(null);
      chart.data.datasets[1].data.push(p.median);
      chart.data.datasets[2].data.push(p.hi);
      chart.data.datasets[3].data.push(p.lo);
    }
  }
}
```

- [ ] **Step 3: 캔버스 컨테이너 높이 보장**

`SimController.astro` 의 `renderChartPlaceholder` 안 `aspect-video` 가 모바일에서 너무 낮을 수 있음 → `h-72 md:h-96` 으로 보완:

```ts
<div class="relative h-72 md:h-96 bg-slate-900 rounded-lg p-2">
  <canvas id="forecast-canvas"></canvas>
</div>
```

- [ ] **Step 4: dev 검증**

```bash
npm run dev
```

`/sim` → AAPL 검색 → 시뮬레이션 시작 → 차트가 좌→우 progressive draw 로 그려짐 (~2초). 1M → 2M → 3M 토글 클릭마다 새 horizon 으로 다시 그려짐. 모바일 폭에서도 차트 높이 충분.

`prefers-reduced-motion` 켜고 확인 (Chrome DevTools → Rendering → Emulate CSS media feature prefers-reduced-motion: reduce) → 즉시 그려짐.

Ctrl-C.

- [ ] **Step 5: 커밋**

```bash
git add src/components/SimController.astro src/layouts/Base.astro
git commit -m "feat(ui): Chart.js forecast with manual progressive draw"
```

---

# Phase 5 — 검증

## Task 18: 수동 QA

**Files:** 없음 (체크리스트 실행)

- [ ] **Step 1: KR 종목 3개 시뮬레이션**

dev 서버 실행 후 `/sim` 에서:
- 005930.KS 삼성전자 (대형, 풍부한 history)
- 293490.KQ 카카오게임즈 (KOSDAQ 중형)
- 247540.KQ 에코프로비엠 (KOSDAQ 변동성 큰 종목)

각 종목에서:
- 표가 최근 10거래일 노출
- 차트가 progressive 로 그려짐
- 1M/2M/3M 토글 모두 정상
- 시장 컨텍스트 표시(강세장/횡보/약세장 + VIX 구간 + 유사 N건)

- [ ] **Step 2: US 종목 3개 시뮬레이션**

- AAPL (대형 안정)
- NFLX (중형 변동성)
- PANW (소형, 비주류 tech)

동일 검증.

- [ ] **Step 3: 자동완성 엣지 케이스**

- 한국어 "삼성" 부분 일치 → 삼성그룹 종목 노출
- 영어 "apple" 대소문자 무시 → AAPL
- 코드 "AAPL" 직접 입력 → 정확 일치 1위
- 빈 입력 → 드롭다운 안 보임
- 결과 0건 (예: "XYZNOTEXIST") → 드롭다운 안 보임
- ↑↓ Enter 키보드 동작
- Escape 로 드롭다운 닫힘

- [ ] **Step 4: regime 셀 분포 점검**

```bash
node -e "
import('./scripts/lib/db.mjs').then(async ({getDb}) => {
  const db = getDb();
  const r = await db.execute('SELECT market, label, vix_band, COUNT(*) AS n FROM regime GROUP BY market, label, vix_band ORDER BY market, label, vix_band');
  console.table(r.rows);
});
"
```

기대: 셀별 row 수 출력. 운영 초기에는 셀 대부분이 0~1건일 수 있음(과거 backfill 안 했으므로). 이게 정상 — predict 가 자동으로 `insufficient_cases` 에러 반환 → UI 에 "표본 부족" 메시지.

**중요:** 운영 1주일 이상 누적 후 다시 확인. 그동안은 표시 종목들이 "표본 부족" 으로 나올 수 있음.

대안: 별도 보조 task — `scripts/backfill-regime.mjs` 로 KOSPI/SPX 일별 close 5년치를 받아 같은 `scoreRegime` 로직 적용해서 일별 regime row 5년치 backfill. **이 보조 task 는 Plan 외 follow-up 으로 분리.**

- [ ] **Step 5: 시장 페이지(/) 회귀 확인**

`/` 로 가서 시장 온도계 정상 동작 확인 (KOSPI/KOSDAQ/SPX/NDX 카드 + VIX gauge + 코멘트).

- [ ] **Step 6: 모바일 반응형 확인**

DevTools 모바일 에뮬레이션 (iPhone 12, Pixel 5) 에서:
- 검색 박스 / 표 / 차트 모두 세로 스택 가독성
- 차트 progressive draw 부드러움
- 표 가로 스크롤 가능

- [ ] **Step 7: 회귀 / 발견된 이슈 정리**

발견한 이슈를 임시 메모 → 작은 건 즉시 fix 후 추가 커밋, 큰 건 별도 GitHub issue 또는 follow-up.

---

# Phase 6 — 구버전 정리

## Task 19: 구버전 코드·페이지·데이터 일괄 삭제

**Files:**
- Delete: 위 "삭제 파일" 목록 전체
- Modify: `package.json` (구 scripts 제거)
- Modify: `.github/workflows/scan.yml` (구 scan:picks/themes 호출 제거)

- [ ] **Step 1: 페이지 + 컴포넌트 삭제**

```bash
rm src/pages/portfolio.astro src/pages/watchlist.astro src/pages/stats.astro
rm src/components/EquityCurve.astro src/components/PositionRow.astro src/components/PickCard.astro
rm src/components/StatsTable.astro src/components/HistoryRow.astro src/components/Sparkline.astro
rm src/components/ThemeCard.astro src/components/ThemeCarousel.astro src/components/ThemeTabs.astro
rm src/components/ActionButton.astro
```

- [ ] **Step 2: 스크립트 + 라이브러리 삭제**

```bash
rm scripts/backtest.mjs scripts/scan-picks.mjs scripts/scan-themes.mjs scripts/tune-vix.mjs
rm scripts/lib/dca-plan.mjs scripts/lib/exit-rules.mjs scripts/lib/portfolio.mjs
rm scripts/lib/backtest-engine.mjs scripts/lib/backtest-aggregate.mjs scripts/lib/scoring.mjs
rm scripts/lib/theme-aggregate.mjs scripts/lib/theme-select.mjs scripts/lib/valuation.mjs
rm scripts/lib/horizon.mjs scripts/lib/history-store.mjs scripts/lib/market-comment.mjs
rm scripts/lib/reason-template.mjs
rm scripts/themes-kr.json scripts/themes-us.json
rm scripts/universe-etf-kr.json scripts/universe-etf-us.json
```

- [ ] **Step 3: 데이터 JSON 삭제**

```bash
rm src/data/backtest.json src/data/picks.json src/data/portfolio.json src/data/watchlist.json src/data/themes.json
```

(`src/data/regime.json` 은 시장 페이지(/) 가 아직 정적 자산으로 읽음 — 유지)

- [ ] **Step 4: HANDOFF.md 삭제**

```bash
rm HANDOFF.md
```

- [ ] **Step 5: package.json scripts 정리**

```json
"scripts": {
  "dev": "astro dev",
  "build": "node scripts/build-tickers-index.mjs && astro build",
  "preview": "astro preview",
  "scan:regime": "node scripts/scan-regime.mjs",
  "ingest:regime": "node scripts/ingest-regime.mjs",
  "ingest:prices": "node scripts/ingest-prices.mjs",
  "ingest:tickers": "node scripts/ingest-tickers.mjs",
  "backfill:prices": "node scripts/backfill-prices.mjs",
  "build:index": "node scripts/build-tickers-index.mjs",
  "scan": "npm run scan:regime && npm run ingest:regime && npm run ingest:prices",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 6: GH Actions workflow 정리**

`.github/workflows/scan.yml` 에서 `npm run scan:picks`, `scan:themes`, JSON 자동 커밋 부분 제거 (DB 적재로 대체).

- [ ] **Step 7: 빌드 검증**

```bash
npm install
npm run build
```

기대: 빌드 성공. dist/ 에 sim.astro + 시장 페이지(/) 만 남음.

- [ ] **Step 8: 테스트 검증**

```bash
npm test
```

기대: autocomplete.test.ts + predict.test.ts + 기존 regime.test.ts(있다면) PASS. 삭제된 모듈 참조하는 테스트 있으면 함께 삭제.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "chore: remove CWC v2 portfolio/watchlist/stats + dead code"
```

---

## Task 20: 문서 정리 (spec archive + README 재작성)

**Files:**
- Move: 구 spec 8개 → `docs/superpowers/archive/`
- Rewrite: `README.md`

- [ ] **Step 1: archive 폴더 생성 + spec 이동**

```bash
mkdir -p docs/superpowers/archive
git mv docs/superpowers/specs/2026-05-26-surge-pick-regime-design.md docs/superpowers/archive/
git mv docs/superpowers/specs/2026-05-27-backtest-design.md docs/superpowers/archive/
git mv docs/superpowers/specs/2026-05-27-bear-regime-design.md docs/superpowers/archive/
git mv docs/superpowers/specs/2026-05-27-etf-hybrid-design.md docs/superpowers/archive/
git mv docs/superpowers/specs/2026-05-27-stop-loss-design.md docs/superpowers/archive/
git mv docs/superpowers/specs/2026-05-27-vix-gate-design.md docs/superpowers/archive/
git mv docs/superpowers/specs/2026-05-27-vix-tune-design.md docs/superpowers/archive/
git mv docs/superpowers/specs/2026-05-28-cwc-portfolio-design.md docs/superpowers/archive/
```

- [ ] **Step 2: 구 plan 들도 archive**

```bash
git mv docs/superpowers/plans/2026-05-26-surge-pick-regime.md docs/superpowers/archive/
git mv docs/superpowers/plans/2026-05-27-backtest.md docs/superpowers/archive/
git mv docs/superpowers/plans/2026-05-27-etf-hybrid.md docs/superpowers/archive/
git mv docs/superpowers/plans/2026-05-27-stop-loss.md docs/superpowers/archive/
git mv docs/superpowers/plans/2026-05-27-vix-gate.md docs/superpowers/archive/
git mv docs/superpowers/plans/2026-05-28-cwc-portfolio.md docs/superpowers/archive/
```

- [ ] **Step 3: README.md 재작성**

```markdown
# surgePick

한국·미국 종목 case-based 시뮬레이터. 종목 하나를 선택하면 과거 차트 + 과거 유사 시장 사례 평균에 기반한 미래 1·2·3개월 예측선을 그려줍니다.

## 페이지

| 경로 | 내용 |
|---|---|
| `/` | 시장 온도계 (VIX·4시장·overall regime) |
| `/sim` | 종목 시뮬레이션 (자동완성 검색 + 표 + 예측 차트) |

## 데이터

- **Turso (libSQL/SQLite)** — `tickers / prices / regime` 3 테이블
- 매일 KST 16:30, ET 16:30 (GitHub Actions) — `scan:regime → ingest:regime → ingest:prices`
- 출처: Yahoo Finance

## 로컬 실행

```bash
npm install
cp .env.local.example .env.local   # Turso URL/Token 채우기
npm run dev   # http://localhost:4321
```

## Scripts

- `npm run scan:regime` — 시장 regime 계산 → `src/data/regime.json`
- `npm run ingest:regime` — regime.json → Turso `regime` 테이블
- `npm run ingest:prices` — 어제 가격 incremental → Turso `prices`
- `npm run ingest:tickers` — universe JSON → Turso `tickers`
- `npm run backfill:prices` — Yahoo 5년 일괄 백필 (1회성)
- `npm run build:index` — `tickers` → `public/tickers-index.json`
- `npm run scan` — 위 세 개를 순차 실행 (운영용)
- `npm test` — Vitest 단위 테스트
- `npm run build` — Astro 빌드 (build:index → astro build)

## 핵심 파일

| 경로 | 역할 |
|---|---|
| `scripts/db/schema.sql` | DB 스키마 |
| `scripts/backfill-prices.mjs` | 5년 가격 백필 |
| `scripts/ingest-prices.mjs` | 일일 가격 증분 |
| `scripts/ingest-regime.mjs` | 일일 regime 증분 |
| `src/lib/predict.mjs` | case-based 예측 알고리즘 |
| `src/lib/autocomplete.mjs` | 자작 prefix/substring 검색 |
| `src/pages/sim.astro` | 종목 시뮬레이션 페이지 |
| `src/components/SimController.astro` | 검색→fetch→표/차트 컨트롤러 |
| `src/components/ForecastChart` (SimController 안 drawChart) | Chart.js progressive draw |
| `docs/superpowers/specs/2026-05-28-stock-simulation-design.md` | 설계 문서 |

## 배포

Vercel hybrid (정적 + serverless API 라우트). `main` push 시 자동 배포.

## 자동 데이터 갱신 (GitHub Actions)

`.github/workflows/scan.yml` cron:
- KST 16:30
- ET 16:30
- 수동 트리거 가능

흐름: `npm ci` → `npm run scan` → Turso 적재. JSON 파일 자동 커밋은 없음 (DB 가 데이터 진실값).

## 면책

본 사이트의 정보는 투자 판단의 참고용이며 매수/매도 추천이 아닙니다. 모든 투자의 책임은 본인에게 있습니다.

데이터 출처: Yahoo Finance.
```

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "docs: archive CWC v2 specs/plans + rewrite README for sim concept"
```

---

# 마무리

모든 task 완료 후:

```bash
git push origin main
```

Vercel 자동 배포 확인 → 라이브에서 `/sim` 동작 확인.

운영 1주일 후:
- regime 셀별 case 분포 재점검
- 표본 부족 메시지 빈도 모니터링
- 필요 시 follow-up plan: `backfill-regime.mjs` (과거 5년 regime 일별 재구성)
