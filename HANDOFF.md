# surgePick 인수인계

> 최종 작업일: **2026-05-29** · 브랜치: `main` · 라이브: https://surge-pick.vercel.app
>
> 상태: **종목 case-based 시뮬레이터 v1 라이브.** Turso DB에 712+ 종목 · 5y 가격 · 5y regime 적재 완료. UI/UX 폴리시 + 자동 데이터 cron 가동 중.
>
> 이 문서는 다른 PC에서 작업을 자연스럽게 이어받기 위한 핸드오프. 위→아래로 읽으면 됨.

---

## 1. 한 줄 요약

종목 하나 검색 → 과거 1달 실제 차트 + 과거 유사 시장 국면 평균 기반 1·2·3개월 예측선. 코사피 200, KOSDAQ 상위, S&P 500, 주요 ETF 약 712개 검색·예측 가능. KOSPI 마감 후 17시·NYSE 마감 후 05시 (KST) 자동 갱신.

---

## 2. 새 PC 셋업 (10분)

### 2.1 Clone + 의존성

```powershell
cd C:\claude          # 또는 임의 작업 폴더
git clone https://github.com/LingCun/surgePick.git
cd surgePick
git checkout main
npm install
```

### 2.2 `.env.local` 만들기

[app.turso.tech](https://app.turso.tech) 로그인 → `surgepick` DB → **Connect** 탭:

```
TURSO_DATABASE_URL=libsql://surgepick-<your-org>.turso.io
TURSO_AUTH_TOKEN=eyJhbGciO...
```

`C:\claude\surgePick\.env.local` 에 붙여넣기. (gitignore 됨)

Token 분실 시: 같은 DB 페이지 **Tokens** 탭 → **Create Token** → "Never" 만료. 기존 데이터에 영향 없음.

### 2.3 연결 확인

```powershell
node scripts/db/check-connection.mjs
# 기대: OK: connection works
```

Sanity:
```powershell
node -e "import('./scripts/lib/db.mjs').then(async({getDb})=>{const d=getDb();for(const t of['tickers','prices','regime']){const r=await d.execute('SELECT COUNT(*) n FROM '+t);console.log(t, r.rows[0].n)}})"
# 기대: tickers ~712 / prices ~875000 / regime ~2350
```

---

## 3. 현재 라이브 상태

### 3.1 페이지

| 경로 | 내용 |
|---|---|
| `/` | 시장 온도계 (VIX·4시장·overall regime) |
| `/sim` | 종목 시뮬레이션 (자동완성 + 차트 + 예측선 + 가격 테이블) |
| `/about` | 예측 방법론 (regime 매칭, 사례 추출, 한계, 출처) |

### 3.2 universe (712 종목)

| 시장 | 출처 | 개수 |
|---|---|---|
| US (S&P 500) | Wikipedia `List_of_S%26P_500_companies` | 503 |
| KR (KOSPI 200) | Korean Wikipedia `KOSPI_200` | 199 |
| KR (KOSDAQ 상위) | 하드코딩 (`scripts/build-universe.mjs` `KOSDAQ_TOP`) | ~50 |
| KR ETFs | 하드코딩 (`EXTRAS_KR`) | 12 (KODEX 200, KODEX 레버리지/인버스, TIGER 미국나스닥100 등) |
| US ETFs | 하드코딩 (`EXTRAS_US`) | 25 (SPY/QQQ/VOO/TQQQ/SOXL/UVXY/GLD 등) |
| KR 수동 추가 | `EXTRAS_KR` (현재 핑거 163730.KQ, 성호전자 043260.KQ) | 2 |

### 3.3 DB 스냅샷

- `tickers` : 712 행
- `prices` : ~875,000 행 (대부분 5년치)
- `regime` : ~2,350 행 (KR 1157 + US 1190, 2021-09-01 ~ 현재)

---

## 4. 예측 알고리즘 (case-based)

1. **regime 라벨**: 매일 KOSPI/S&P 500 추세·모멘텀·변동성·VIX → `bull` / `neutral` / `bear`
2. **VIX band**: US는 VIX 값 (`<15` low, `<25` mid, `≥25` high) / KR은 vol20 (`<0.15` low, `<0.30` mid, else high)
3. **case 매칭** (`scripts/lib/predict.mjs` → `matchCases`): 현재 ctx와 (market + label + vix_band) 일치하는 과거 날짜
4. **폴백 단계** (`predict()`):
   - 1차: `cases.length < 10` → vix_band 드롭, market+label만
   - 2차: `cases.length < 3` → label도 드롭, market only (5년 전체)
   - 최소 3개 미만이면 `insufficient_cases` 에러 → UI에 "예측 불가" 표시
5. **궤적 평균** (`normalizeTrajectory` + `aggregateBands`): 각 case 날짜를 0%로 잡고 1~horizon일 수익률, p25/p50/p75 percentile
6. **신뢰도 워닝**: `case_count < 30`이면 SimController가 amber 배너 표시

### 4.1 알려진 한계

- case 매칭 차원은 시장 regime + VIX band 뿐. **섹터·시총·실적·뉴스 미반영**.
- 표본 작은 종목 (예: 핑거) 예측이 한쪽으로 치우치기 쉽다 → 워닝 + about 페이지로 사용자에게 명시.

---

## 5. 자동 데이터 파이프라인

### 5.1 cron schedule

| 워크플로 | 시간 (KST) | 시간 (UTC cron) | 역할 |
|---|---|---|---|
| `scan.yml` | 17:00 (KR 마감 후) | `0 8 * * 1-5` | regime 계산 + 오늘 가격 증분 |
| `scan.yml` | 05:00 (US EDT 마감 후) | `0 20 * * 1-5` | 동상 |
| `scan.yml` | 06:00 (US EST 마감 후, DST 대비) | `0 21 * * 1-5` | 동상 |
| `reindex.yml` | 17:00 매일 | `0 8 * * *` | universe 재스크레이프 (KOSPI 200/S&P 500/KOSDAQ_TOP/EXTRAS) + 신규 종목 prices backfill + autocomplete index |

### 5.2 수동 트리거 워크플로

| 워크플로 | 용도 |
|---|---|
| `ingest.yml` | 1회성 전체 초기화 (ticker seed + 5y prices backfill + regime backfill + 오늘 regime + index). 50분+ 소요. |
| `reindex.yml` | universe + 신규 종목 fast path (`backfill:prices:new`만 동작 — DB에 <1000 rows인 종목 backfill). ~5분. |
| `backfill-regime.yml` | KR/US 5년 일별 regime 재계산. ~30초. |
| `build-universe.yml` | universe-*.json + 신규 backfill + index 재구축. ~20-30분. |

### 5.3 npm scripts

- `scan:regime` / `ingest:regime` / `ingest:prices` / `ingest:tickers` — 일일 갱신용
- `backfill:prices` — 전체 5y backfill (slow)
- `backfill:prices:new` — 신규/희박 종목만 (≥1000 rows 미달)
- `backfill:regime` — 5년 regime
- `build:universe` — Wikipedia/Naver 스크레이프 (Yahoo 가능 환경 필요)
- `build:index` — DB → `public/tickers-index.json`
- `npm run scan` = scan:regime → ingest:regime → ingest:prices

---

## 6. UI 폴리시 (오늘 마무리)

### 6.1 sim 페이지 (/sim)

- gradient hero (cyan→sky)
- 큰 1M/2M/3M horizon 카드 (활성시 글로우)
- 검색 입력: 돋보기 아이콘 + X 클리어 버튼 + "최근:" chip 5개 (localStorage)
- 차트 헤더 카드: 깃발 + 이름 + 코드/거래소 + 현재가 + 공유 버튼
- regime 배지 색깔 (bull=emerald, bear=rose, neutral=slate)
- case_count<30 워닝 배너
- 차트: 좌·우 대칭, x축 한글 (`M월 d일`) + 툴팁 (`yyyy년 M월 d일`), "오늘" 세로 점선 + 음영
- 가격 테이블: ▲▼ 화살표, tabular-nums, hover 하이라이트
- "시뮬레이션 시작" 클릭 시 `#sim-result`로 smooth scroll

### 6.2 공유 / 직링크

- 차트 헤더의 공유 아이콘: `navigator.share()` 우선, 클립보드 폴백
- URL: `/sim?ticker=AAPL&h=60` 형식 → 페이지 로드시 자동 pick + run
- 사용자 액션마다 `history.replaceState`로 URL 동기화

### 6.3 about 페이지 (/about)

방법론 5섹션:
1. regime 매칭
2. 유사 사례 추출
3. 궤적 평균
4. 한계
5. 데이터 출처

상단 nav 우측에 "방법" 탭으로 링크.

### 6.4 layout

- Base.astro nav: `시장 / 시뮬레이션 / 방법(우측)`
- bg-slate-950 다크 + Pretendard 폰트
- Tailwind 3 + 인라인 `<style is:global>` (Astro 자동 스코프 회피)

---

## 7. 알려진 이슈 / 미해결 follow-up

### 7.1 인앱 브라우저 (카카오톡/인스타/트위터)

- modern CSS (grid/gradient/CSS variables) 깨먹는 경우 있음 → 흰 바탕 + 버튼 수직 나열
- 현재 대처: 사용자에게 "외부 브라우저로 열기" 안내
- TODO: User-Agent 감지해서 상단 배너 노출

### 7.2 KOSDAQ universe 부분 (50개)

- Wikipedia 韩(한)·英 둘 다 KOSDAQ 150 페이지 없음
- 현재 `KOSDAQ_TOP` 하드코딩 50종목 (시가총액 상위 위주)
- 완전 150개 채우려면: KRX 공식 API (POST + 세션) 또는 또 다른 소스 필요

### 7.3 거래량 바 (deferred)

- `prices` 테이블에 volume 컬럼 없음
- 추가하려면: schema migration + 전체 backfill 재실행 + Chart.js 2nd axis
- 다음 라운드 작업

### 7.4 예측 신뢰도 워닝

- 현재 `case_count < 30` 단순 임계값
- 더 정교한 모형: 표준편차/분산 기반 신뢰 점수, 종목별 변동성 가중 등 → 다음 라운드

### 7.5 종목 비교 모드

- 2 종목 차트 겹쳐서 비교 — 차별화 기능, 아직 없음

### 7.6 OG 메타 / favicon

- 카카오톡/트위터 공유시 카드가 깨짐 — `og:image`, `og:title`, favicon 미설정
- 추가 권장

### 7.7 KOSDAQ 가격 데이터 race

- daily cron이 Yahoo 데이터 갱신 전 트리거되면 stale 적재 가능
- 현재 +1h 버퍼 잡았으나 Yahoo 지연 시 가끔 빈 적재 가능

---

## 8. 핵심 파일

| 경로 | 역할 |
|---|---|
| `scripts/build-universe.mjs` | KOSPI 200 (ko-Wiki) + S&P 500 (en-Wiki) 스크레이프 + KOSDAQ_TOP/EXTRAS 머지 |
| `scripts/backfill-prices.mjs` | 전체 5y 가격 backfill |
| `scripts/backfill-prices-new.mjs` | <1000 rows 종목만 backfill (신규 ticker 대응) |
| `scripts/backfill-regime.mjs` | 5년 일별 regime 재계산 |
| `scripts/ingest-tickers.mjs` | universe-*.json → DB |
| `scripts/ingest-prices.mjs` | 어제 종가 증분 |
| `scripts/ingest-regime.mjs` | scan-regime → DB |
| `scripts/scan-regime.mjs` | Yahoo → regime.json |
| `scripts/db/schema.sql` | DB 스키마 (tickers/prices/regime) |
| `scripts/db/apply-schema.mjs` | DDL 적용 (idempotent) |
| `src/lib/predict.mjs` | case-based 예측 (matchCases + normalizeTrajectory + aggregateBands + predict) |
| `src/lib/autocomplete.mjs` | prefix/substring 검색 (정확 > ticker prefix > 이름 prefix > 이름 substring) |
| `src/pages/sim.astro` | 시뮬레이션 페이지 + horizon picker |
| `src/pages/about.astro` | 방법론 페이지 |
| `src/pages/index.astro` | 시장 페이지 |
| `src/pages/api/ticker.ts` | `/api/ticker?id=X&horizon=N` SSR |
| `src/pages/api/search.ts` | `/api/search?q=Q` SSR fallback |
| `src/components/SimController.astro` | sim 메인 컨트롤러 (차트 + 가격 테이블) |
| `src/components/TickerSearch.astro` | 검색 + 자동완성 + 최근 + X 클리어 + URL 파라미터 적용 |
| `src/layouts/Base.astro` | 공통 레이아웃 (nav, footer, Chart.js CDN) |
| `.github/workflows/scan.yml` | 일일 cron (KR 17:00 / US 05:00 / EST 06:00 KST) |
| `.github/workflows/reindex.yml` | 매일 17:00 KST universe + 신규 backfill |
| `.github/workflows/ingest.yml` | 1회성 전체 초기화 (수동) |
| `.github/workflows/backfill-regime.yml` | regime 5년 backfill (수동) |
| `.github/workflows/build-universe.yml` | universe + 전체 backfill + index (수동) |

---

## 9. 새 PC에서 처음 할 일

1. `git pull origin main` — 항상 main 동기화
2. `.env.local` 확인 (Turso 자격증명)
3. `npm install && npm test` (50 pass) + `npm run build` (성공)
4. `npm run dev` → `http://localhost:4321/sim` 검색·차트 확인
5. 변경 작업 → commit → push → Vercel 자동 배포 (1-2분)

---

## 10. 자주 쓰는 명령

```bash
# 종목 추가
# scripts/build-universe.mjs 의 EXTRAS_KR / EXTRAS_US 에 entry 추가 + push
gh workflow run reindex.yml   # ~5분 후 autocomplete + prices 자동 적재

# universe 즉시 재구축 (Wikipedia 신규 편입 종목 캐치)
gh workflow run reindex.yml

# 워크플로 진행 상태
gh run list --workflow=reindex.yml --limit 3
gh run view <run_id> --log

# 라이브 검증
curl -s "https://surge-pick.vercel.app/api/search?q=삼성" | head -c 500
curl -s "https://surge-pick.vercel.app/api/ticker?id=005930.KS&horizon=30" | head -c 500
```

---

## 11. 푸시 상태

`main` 브랜치에 모든 작업 적용. PR #2 (CWC v2 → sim 피벗) 머지 완료. Vercel auto-deploy on main push (1-2분 후 라이브).

`feat/stock-simulation` 브랜치는 PR #2 머지 + 자동 삭제됨.

---

## 12. 다음 라운드 후보 (우선순위)

1. 거래량 바 (DB schema migration + Chart.js 2nd axis) — 1시간
2. 인앱 브라우저 배너 ("외부 브라우저로 열기") — 20분
3. 즐겨찾기 ⭐ (recent 너머 영구 핀) — 30분
4. 종목 비교 모드 (2 종목 차트 겹쳐) — 1시간
5. KOSDAQ 150 완전 (KRX API or 다른 소스) — 1시간
6. og:image / favicon / PWA manifest — 30분
7. /api/ticker 캐시 헤더 (Cache-Control 15min) — 5분
8. Pretendard 폰트 CDN — 5분
9. FAQ / 예시 (about 페이지 확장) — 30분
10. 실시간 가격 (현재 EOD) — 별도 plan 필요
