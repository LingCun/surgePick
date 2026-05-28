# 종목 시뮬레이션 페이지 설계

작성일: 2026-05-28
상태: 디자인 확정, 사용자 리뷰 대기

## 1. 개요

surgePick 의 컨셉을 **CWC v2 포트폴리오 시뮬레이터** 에서 **단일 종목 시뮬레이터** 로 피벗한다.

사용자가 한국·미국 종목 중 하나를 검색·선택하면, 그 종목의 과거 가격을 차트로 그리고, **현재 시장 컨텍스트(KR/US regime + VIX 구간)와 비슷했던 과거 시점들의 사례를 평균** 내어 미래 1·2·3개월 예측선을 그린다.

차트는 좌→우 progressive draw 효과로 한 포인트씩 그려진다.

## 2. 변경 사항

### 유지
- `/` (시장 온도계) 페이지
- `scripts/scan-regime.mjs` (case 매칭의 핵심 키)
- 시장 페이지에서 쓰는 컴포넌트들 (`FearGaugeCard`, `IndexChart`, `MarketMoodCard`, `OverallCard`)

### 신규
- `/sim` 단일 페이지 (종목 검색 + 시뮬레이션)
- Turso (libSQL) DB 도입
- `tickers` / `prices` / `regime` 테이블
- Ingest 파이프라인 4종 (tickers / prices backfill / prices daily / regime)
- 빌드 타임 `public/tickers-index.json` 생성
- `src/lib/predict.mjs` case-based 예측 알고리즘
- `src/lib/autocomplete.mjs` 자작 prefix/substring 검색
- API 라우트 2개 (`/api/search`, `/api/ticker`)
- Chart.js 통합 + 수동 progressive draw

### 제거
- 페이지: `/portfolio`, `/watchlist`, `/stats`
- 컴포넌트: `EquityCurve`, `PositionRow`, `PickCard`, `StatsTable`, `HistoryRow`, `Sparkline`, `ThemeCard`, `ThemeCarousel`, `ThemeTabs`, `ActionButton`
- 스크립트: `backtest.mjs`, `scan-picks.mjs`, `scan-themes.mjs`, `tune-vix.mjs`
- 라이브러리: `dca-plan.mjs`, `exit-rules.mjs`, `portfolio.mjs`, `backtest-engine.mjs`, `backtest-aggregate.mjs`, `scoring.mjs`, `theme-aggregate.mjs`, `theme-select.mjs`, `valuation.mjs`, `horizon.mjs`, `history-store.mjs`, `market-comment.mjs`, `reason-template.mjs`
- 데이터: `src/data/backtest.json`, `picks.json`, `portfolio.json`, `watchlist.json`, `themes.json`
- 인수인계 문서: `HANDOFF.md`
- `package.json` scripts: `backtest`, `scan:picks`, `scan:themes`, `tune:vix`
- 구버전 spec 들은 `docs/superpowers/archive/` 로 이동

## 3. 데이터 모델 (Turso 스키마)

```sql
-- 종목 마스터 (자동완성 + 필터)
CREATE TABLE tickers (
  ticker    TEXT PRIMARY KEY,        -- '005930' | 'AAPL'
  name_kr   TEXT,                    -- '삼성전자'
  name_en   TEXT,                    -- 'Samsung Electronics'
  market    TEXT NOT NULL,           -- 'KR' | 'US'
  exchange  TEXT,                    -- 'KOSPI' | 'KOSDAQ' | 'NYSE' | 'NASDAQ'
  active    INTEGER DEFAULT 1
);
CREATE INDEX idx_tickers_name_kr ON tickers(name_kr);
CREATE INDEX idx_tickers_name_en ON tickers(name_en);

-- 일일 가격
CREATE TABLE prices (
  ticker    TEXT NOT NULL,
  date      TEXT NOT NULL,           -- 'YYYY-MM-DD'
  open      REAL NOT NULL,
  close     REAL NOT NULL,
  high      REAL,
  low       REAL,
  PRIMARY KEY (ticker, date)
);
CREATE INDEX idx_prices_date ON prices(date);

-- 시장 regime (일별, 시장별)
CREATE TABLE regime (
  date      TEXT NOT NULL,
  market    TEXT NOT NULL,           -- 'KR' | 'US'
  label     TEXT NOT NULL,           -- 'bull' | 'bear' | 'neutral'
  vix       REAL,
  vix_band  TEXT,                    -- 'low' | 'mid' | 'high'
  PRIMARY KEY (date, market)
);
CREATE INDEX idx_regime_lookup ON regime(market, label, vix_band);
```

스케일 (5년 retention 기준):

| 테이블 | rows | 용량 |
|---|---|---|
| tickers | ~10,500 | ~1 MB |
| prices | ~13M | ~300 MB |
| regime | ~3,700 | <1 MB |

Turso 무료 9 GB 충분.

## 4. 데이터 파이프라인

```
scripts/
  db/schema.sql              -- DDL
  ingest-tickers.mjs         -- 월 1회: KRX listing CSV + Nasdaq Trader 파일 → tickers
  backfill-prices.mjs        -- 1회성: Yahoo Finance 5년 일괄, ~30~60분
  ingest-prices.mjs          -- 매일: 어제 날짜만 increment
  ingest-regime.mjs          -- 매일: scan-regime.mjs 결과 → regime 테이블
  build-tickers-index.mjs    -- 빌드 시: tickers → public/tickers-index.json
```

GitHub Actions cron (`.github/workflows/scan.yml`):
- KST 16:30, ET 16:30 cron 두 개 유지
- 흐름 변경: `scan-regime → ingest-regime → ingest-prices` (regime 먼저, 가격 그 다음)
- 산출물이 `src/data/*.json` 이 아니라 Turso 직접 적재로 변경
- 시장 페이지(`/`)가 쓰는 `regime.json` 은 빌드 타임에 Turso 에서 읽어 정적 자산으로 굽거나, SSR 로 직접 쿼리

## 5. Case-based 예측 알고리즘

### 입력
- `ticker` — 예: `'005930'`
- `today` — 시뮬레이션 기준일 (기본: 최신 거래일)
- `horizonDays` — `30 | 60 | 90` (1·2·3개월)

### 단계

```js
// 1. 오늘의 시장 컨텍스트
const market = ticker.market;
const ctx = regime[market][today];   // { label, vix_band }

// 2. 과거에서 같은 (market, label, vix_band)인 날들 검색
//    오버랩 방지: 매칭일 + horizonDays 가 today 를 넘지 않도록
let cases = SELECT date FROM regime
  WHERE market = ?
    AND label = ?
    AND vix_band = ?
    AND date < DATE(?, '-' || ? || ' days')
  ORDER BY date DESC
  LIMIT 100;

// 3. Fallback
if (cases.length < 10) drop(vix_band);   // label만으로 재매칭
if (cases.length < 5)  return baseline(); // 일반 평균선 (또는 에러)

// 4. 각 case 일자 t_i 에 대해 종목 정규화 궤적
//    r_i(d) = close(t_i + d) / close(t_i) - 1, d = 0..horizonDays
const trajectories = cases.map(c => normalize(prices[ticker], c.date, horizonDays));

// 5. d 별 percentile 집계
const bands = range(0, horizonDays).map(d => ({
  d,
  p50: median(trajectories.map(t => t[d])),
  p25: q25(trajectories.map(t => t[d])),
  p75: q75(trajectories.map(t => t[d])),
}));

// 6. 예측선 = 오늘 종가 × (1 + bands[d].p50)
const todayClose = prices[ticker][today].close;
return bands.map(b => ({
  date: addCalendarDays(today, b.d),
  median: todayClose * (1 + b.p50),
  lo:     todayClose * (1 + b.p25),
  hi:     todayClose * (1 + b.p75),
}));
```

### 엣지 케이스

| 상황 | 처리 |
|---|---|
| 신규 상장 종목 (case 일자에 가격 데이터 없음) | 해당 case 스킵, 표본 수 줄어듦 |
| 매칭 0건 (Fallback 모두 실패) | "예측 불가, 시장 컨텍스트 표본 부족" 메시지 |
| KR/US 외 종목 | 검색 결과에서 제외 |
| `today + horizonDays` 가 미래 (정상) | 정상 동작 — 어차피 미래 예측 |
| case 일자 + horizonDays 가 today 를 넘음 (오버랩) | 매칭 SQL 에서 제외 |

### 정직성 원칙
- 메디안은 **점선** 으로 표시 (실선은 실제만)
- p25-p75 음영으로 **불확실성** 가시화
- horizon 길수록 음영 자연스럽게 넓어짐
- 호버 시 "유사 사례 N건, regime=bull, VIX=mid" 노출 → 사용자가 표본 수 확인 가능

## 6. UI

### 페이지 레이아웃 (`/sim`)

```
┌──────────────────────────────────────────────────────┐
│  surgePick      [시장]   [종목 시뮬레이션]            │
├──────────────────────────────────────────────────────┤
│                                                      │
│  🔍  [삼성_____________________]                     │
│      ┌────────────────────────────────────┐         │
│      │ 🇰🇷  005930  ·  삼성전자          │         │
│      │ 🇰🇷  006400  ·  삼성SDI           │         │
│      │ 🇰🇷  028260  ·  삼성물산          │         │
│      └────────────────────────────────────┘         │
│                                                      │
│  [ 시뮬레이션 시작 ]                                 │
│                                                      │
├──────────────────────────────────────────────────────┤
│  📋  삼성전자 (005930)    ₩72,300                    │
│      시장 컨텍스트: 강세장 · VIX 보통 · 유사 47건   │
│                                                      │
│      날짜        │ 시가     │ 종가     │ 변동       │
│      2026-05-27  │ 72,100   │ 72,300   │ +0.3%      │
│      2026-05-26  │ 71,500   │ 72,000   │ +0.7%      │
│      ... 최근 10거래일                              │
│                                                      │
├──────────────────────────────────────────────────────┤
│  📈 차트                  [ 1M ][ 2M ][ 3M ]         │
│                                                      │
│       실제 60일 (실선, 진청색)                       │
│         ╱╲╱╲              p75-p25 음영(옅은 청록)   │
│        ╱    ╲         ┄┄┄┄┄┄┄ 메디안 예측(점선)    │
│                  ●오늘  ┄┄┄┄┄                       │
│                                                      │
│      과거 ─────────────────● 앞으로                  │
└──────────────────────────────────────────────────────┘
```

### 자동완성

- 데이터: `public/tickers-index.json` (빌드 시 생성, ~150 KB gzip)
- 로직: 자작 prefix + substring (한국어 이름, 영어 이름, ticker 코드 모두 검색)
- debounce 150 ms, 결과 최대 8개
- ↑↓ Enter 키 지원
- 시장 이모지 (🇰🇷 / 🇺🇸) 로 KR/US 구분
- 빈 상태: localStorage 의 "최근 검색" 5개 노출
- 종속성: 외부 라이브러리 없음 (Fuse.js 등 미사용)

### 기간 토글 + Progressive Draw

기간 토글: 차트 영역 바로 위, `[1M][2M][3M]` 세그먼트 버튼.

| horizon | 과거 표시 | 미래 표시 | 총 포인트 |
|---|---|---|---|
| 30일 (1M) | 60일 | 30일 | ~90 |
| 60일 (2M) | 90일 | 60일 | ~150 |
| 90일 (3M) | 120일 | 90일 | ~210 |

토글 변경 시: `chart.destroy()` → 새 데이터로 새 인스턴스 → progressive draw 재실행.

### Chart.js 수동 제어 Progressive Draw

```js
const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      { label: '실제',          data: [], borderColor: '#1e40af', fill: false, pointRadius: 0 },
      { label: '예측 메디안',    data: [], borderDash: [6,4], borderColor: '#0e7490', fill: false, pointRadius: 0 },
      { label: '예측 p25-p75',  data: [], fill: '-1', backgroundColor: 'rgba(14,116,144,0.15)', borderWidth: 0 },
    ],
  },
  options: {
    animation: false,           // 내장 애니메이션 끔
    responsive: true,
    scales: { x: { type: 'time' } },
  },
});

const all = [...history, ...forecast];   // 시간 순
const totalMs = 2000;                    // 2초에 걸쳐
const msPerPoint = totalMs / all.length;
let i = 0;
let lastTs = performance.now();

function tick(now) {
  if (now - lastTs >= msPerPoint) {
    const point = all[i];
    chart.data.labels.push(point.date);
    if (point.isHistory) {
      chart.data.datasets[0].data.push(point.close);
      chart.data.datasets[1].data.push(null);
      chart.data.datasets[2].data.push(null);
    } else {
      chart.data.datasets[0].data.push(null);
      chart.data.datasets[1].data.push(point.p50);
      chart.data.datasets[2].data.push({ y: [point.p25, point.p75] });
    }
    chart.update('none');
    i++;
    lastTs = now;
  }
  if (i < all.length) requestAnimationFrame(tick);
  else onDoneDraw();    // 오늘 지점 vertical line 강조 등 후처리
}
requestAnimationFrame(tick);
```

### 접근성
- `prefers-reduced-motion: reduce` 감지 시 progressive draw 스킵, 즉시 전체 그리기
- 검색 결과 dropdown 은 `role="listbox"` + `aria-activedescendant`
- 기간 토글은 `role="tablist"` + `aria-selected`

### 모바일 반응형
- 검색 / 표 / 차트 세 영역 세로 스택
- 표는 가로 스크롤 허용
- 차트 `aspectRatio` 데스크탑 16:9, 모바일 4:3 자동 전환

## 7. API 엔드포인트

```
GET /api/search?q=삼성
    → [{ ticker, name_kr, name_en, market, exchange }, ...]   // 최대 20개

GET /api/ticker?id=005930&horizon=30
    → {
        ticker: { ticker, name_kr, name_en, market },
        prices: [{ date, open, close }, ...],   // 최근 horizon*2 일
        context: { label, vix_band, case_count, today_close },
        forecast: [{ date, median, lo, hi }, ...]  // 길이 horizon
      }
```

자동완성용 `/api/search` 는 사실상 정적 인덱스로 대체 가능. 필요 시 SSR fallback 으로만 유지.

## 8. 마이그레이션 순서

```
Phase 1 — 인프라 준비 (기존 코드 그대로)
  □ Turso 가입, DB 프로비저닝
  □ scripts/db/schema.sql 작성·적용
  □ .env.local + Vercel + GH Secrets: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
  □ @libsql/client 의존성 추가
  □ 첫 연결 테스트 스크립트

Phase 2 — Ingest 파이프라인
  □ scripts/ingest-tickers.mjs (KRX + Nasdaq listing)
  □ scripts/backfill-prices.mjs (Yahoo 5년 일괄)
  □ scripts/ingest-prices.mjs (일일 increment)
  □ scripts/ingest-regime.mjs (기존 regime 결과 → DB)
  □ scripts/build-tickers-index.mjs (빌드 시 정적 인덱스 생성)
  □ .github/workflows/scan.yml 수정

Phase 3 — 신규 페이지 (기존 페이지 살아있음)
  □ src/pages/sim.astro 스캐폴드 + 네비 링크 추가
  □ src/pages/api/search.ts
  □ src/pages/api/ticker.ts
  □ src/components/TickerSearch.astro (+ client island)
  □ src/components/PriceTable.astro
  □ src/lib/autocomplete.mjs + 테스트
  □ src/lib/predict.mjs + 테스트
  □ src/components/ForecastChart.astro (Chart.js client island)

Phase 4 — 검증
  □ /sim 페이지 수동 QA: KR 3종 + US 3종 시뮬레이션
  □ regime 셀별 case 분포 점검 (각 셀 ≥ 10건 목표)
  □ 시장 페이지(/) 정상 동작 확인

Phase 5 — 구버전 정리 (단일 커밋, 되돌리기 쉽게)
  □ src/pages/{portfolio,watchlist,stats}.astro 삭제
  □ src/components/{EquityCurve,PositionRow,PickCard,StatsTable,HistoryRow,Sparkline,ThemeCard,ThemeCarousel,ThemeTabs,ActionButton}.astro 삭제
  □ scripts/{backtest,scan-picks,scan-themes,tune-vix}.mjs 삭제
  □ scripts/lib/{dca-plan,exit-rules,portfolio,backtest-engine,backtest-aggregate,scoring,theme-aggregate,theme-select,valuation,horizon,history-store,market-comment,reason-template}.mjs 삭제
  □ src/data/{backtest,picks,portfolio,watchlist,themes}.json 삭제
  □ package.json scripts 정리
  □ HANDOFF.md 삭제
  □ CWC v2 / 포트폴리오 / 백테스트 관련 구버전 spec 일괄 archive 이동
    (docs/superpowers/specs/2026-05-26-surge-pick-regime-design.md,
     2026-05-27-backtest-design.md, 2026-05-27-bear-regime-design.md,
     2026-05-27-etf-hybrid-design.md, 2026-05-27-stop-loss-design.md,
     2026-05-27-vix-gate-design.md, 2026-05-27-vix-tune-design.md,
     2026-05-28-cwc-portfolio-design.md → docs/superpowers/archive/)
    단, scan-regime 관련 spec 은 유지 (현 디자인에서도 사용)
  □ README.md 재작성
```

## 9. 테스트 전략 (Vitest)

### 단위 테스트
- `src/lib/predict.test.ts`
  - case 매칭 정상 / fallback 1단계 / fallback 2단계 / case 0건 처리
  - 정규화 궤적 계산 (normalize)
  - percentile 집계 (median, q25, q75)
  - 신규 상장 종목 (가격 결측 일자 스킵)
- `src/lib/autocomplete.test.ts`
  - prefix 매칭 (한/영/ticker)
  - substring 매칭
  - 정렬 우선순위 (정확 일치 > prefix > substring)
  - 빈 쿼리 / 결과 0건
- `scripts/lib/ingest.test.ts`
  - Yahoo Finance 응답 mock → 파싱
  - 결측 일자 처리
  - 종목명 한국어/영어 병합

### 통합 테스트
- libSQL 로컬 파일 (`file:test.db`) 에 fixture 적재
- API 라우트 (`/api/search`, `/api/ticker`) 호출 → JSON 응답 스키마 검증
- regime 셀별 case ≥ 10 건 확보되는지 fixture 기준 sanity

### 수동 QA 체크리스트
- KR 종목: 삼성전자(대형), 카카오게임즈(KOSDAQ 중형), 최근 상장 신규 종목 1개
- US 종목: AAPL, 중형 tech 1개, 비주류 1개
- 자동완성 한국어 부분 일치 ("삼성" → 삼성그룹)
- 자동완성 키보드 ↑↓ Enter
- 기간 토글 (1M/2M/3M) 전환 시 progressive draw 재실행 확인
- 차트 progressive draw 데스크탑 + 모바일 (iOS Safari + Android Chrome)
- `prefers-reduced-motion` 환경에서 즉시 그리기 확인
- 예측 0건 fallback 메시지 노출 (인위적으로 vix_band 없는 종목 만들어 검증)
- 시장 페이지(/) 정상 동작

## 10. 운영 / 리스크

| 리스크 | 영향 | 완화책 |
|---|---|---|
| Yahoo Finance KR 종목명 누락 | 자동완성 검색 품질 저하 | KRX 공식 listing 별도 ingest, fallback 영문명 노출 |
| 초기 backfill Turso 쓰기 한도 | backfill 실패 | 1000 rows/transaction 배치, 종목 단위 재시도, rate-limit 시 sleep 200 ms |
| regime 셀 불균형 (특정 라벨 case 부족) | 일부 시뮬 fallback 작동 | 알고리즘 자동 fallback 처리, 모니터링은 수동 |
| Vercel runtime 선택 (Edge vs Serverless) | libSQL 호환성 / 콜드 스타트 | Phase 1 첫 연결 테스트에서 두 runtime 모두 검증, 호환성·지연 더 나은 쪽 선택. 디폴트는 Serverless (Astro 4 + @astrojs/vercel 기본) |
| 일일 ingest 실패 (Yahoo 일시 장애) | regime/prices 결측 | GH Actions 재시도 1회, 다음 cron 에서 어제+오늘 합쳐 적재 |
| Chart.js progressive draw 모바일 발열 | 저사양 기기 끊김 | `prefers-reduced-motion` 즉시 그리기 fallback, `requestIdleCallback` 부하 분산 |
| Turso 무료 티어 정책 변경 | 운영 비용 발생 | 발생 시 정적 SQLite 자산 모드로 임시 전환 가능 (sql.js) |

## 11. 작업 시간 추정

| Phase | Claude 작업 시간 | 사람 개입 |
|---|---|---|
| 1. 인프라 | 1 h | Turso 가입·secret 등록 ~15분 |
| 2. Ingest 코드 | 2 h | KRX 종목 마스터 CSV 받기 ~15분 |
| 2b. Backfill 실행 | (대기 30–60분) | 없음 |
| 3. UI 구현 | 4 h | 없음 |
| 4. 테스트 | 2 h | 없음 |
| 5. 수동 QA | (지원) | 30분 |
| 6. 구버전 정리 | 1 h | 없음 |
| **합계** | **~10 h + 대기 1 h** | **~1 h** |

보수적(마찰 +50%): **~15 h / 3 세션**.

## 12. 의도적으로 제외된 것 (YAGNI)

- 회원가입·즐겨찾기 종목 (localStorage 의 최근 검색으로 충분)
- 종목 비교 (여러 종목 동시 시뮬)
- 베너 카드·매크로 시그널 추가 표시
- 거래량 / 재무 지표 / 뉴스
- 알림·푸시
- 백테스트 (case-based 자체가 backward-looking 이므로 별도 검증 불필요한 단계)
- 사용자 입력 가상 시장 시나리오 (what-if)
- 시계열 모델 (ARIMA/LSTM) — case-based 가 해석 가능성·재현성 면에서 우위

## 13. 결정 항목 요약

| 항목 | 결정 |
|---|---|
| 컨셉 | 시장 탭 유지 + 종목 시뮬레이션 단일 신규 탭 |
| 예상 그래프 | 미래 1·2·3개월 선택 (30/60/90일) |
| 예측 방식 | Case-based (과거 유사 regime 사례 평균) |
| 매칭 키 | regime 라벨 + VIX 구간 |
| DB | Turso (libSQL/SQLite) |
| Retention | 5년 |
| 자동완성 | 빌드 타임 `tickers-index.json` + 자작 prefix/substring |
| 차트 라이브러리 | Chart.js |
| Progressive Draw | 수동 제어 (requestAnimationFrame, 2초 타이핑 효과) |
| 기간 토글 | 차트 위 `1M / 2M / 3M`, 변경 시 재시뮬 |
| 마이그레이션 | 5단계, 기존 코드는 마지막 단일 커밋으로 정리 |
