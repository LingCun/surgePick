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
