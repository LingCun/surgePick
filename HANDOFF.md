# surgePick 인수인계 — 종목 시뮬레이션 피벗

> 최종 작업일: **2026-05-29** · 브랜치: `feat/stock-simulation` · 다음 진입점: **Task 18 (Vercel preview 에서 수동 QA)** — 유일하게 남은 작업
>
> 진행: **Task 4~17, 19, 20 완료.** 데이터 적재(ingest.yml) Actions 성공 → Turso 적재됨. UI 전부 구현. Vercel 500 + 런타임 에러 수정. 구버전(portfolio/watchlist/stats) 삭제하고 **탭 2개(홈/시뮬레이션)로 통합**. 구 spec/plan 14개 archive 이동, README 재작성. 남은 건 **Task 18 QA**(Vercel preview 에서 `/sim` 실동작 확인) — Vercel Deployment Protection 켜져있어 401, 본인 브라우저 로그인 상태로 직접 QA 필요.
>
> 이 문서는 다른 PC 에서 작업을 자연스럽게 이어받기 위한 핸드오프야. 위에서 아래로 순서대로 읽으면 돼.

---

## 1. 한 줄 요약

surgePick 을 CWC v2 포트폴리오 시뮬레이터에서 **단일 종목 case-based 시뮬레이터**로 피벗 중. 20개 task 중 **Task 1~4 완료**, Turso DB 가 살아있고 ticker 60건이 적재된 상태. Task 5 부터 이어 가면 됨.

---

## 2. 새 PC에서 환경 세팅 (10분)

### 2.1 리포 clone + 브랜치 체크아웃

```powershell
cd C:\claude          # 또는 새 PC 의 작업 폴더
git clone https://github.com/LingCun/surgePick.git
cd surgePick
git fetch origin
git checkout feat/stock-simulation
```

### 2.2 의존성 설치

```powershell
npm install
```

### 2.3 `.env.local` 만들기

Turso 가입은 이전 PC 에서 끝났음. 같은 DB 를 재사용해야 함.

[app.turso.tech](https://app.turso.tech) 로그인 → 좌측 **Databases** → `surgepick` 클릭 → **Connect** 탭에서:

```
TURSO_DATABASE_URL=libsql://surgepick-<your-org>.turso.io
TURSO_AUTH_TOKEN=eyJhbGciO...
```

두 줄을 그대로 복사해서 새 PC 의 `C:\claude\surgePick\.env.local` 파일에 붙여넣어. (gitignore 되어있어 커밋 안 됨)

**Auth Token 이 안 보이면**: 같은 DB 페이지의 **Tokens** 탭 → **Create Token** → 만료 "Never" 또는 가장 긴 옵션 → 발급된 토큰 복사. (구 토큰이 분실됐어도 새로 만들면 됨, 기존 데이터엔 영향 없음.)

### 2.4 연결 확인

```powershell
node scripts/db/check-connection.mjs
```

기대 출력:
```
◇ injected env (2) from .env.local
OK: connection works
```

추가 sanity (이전에 적재한 60 종목 살아있는지):
```powershell
node -e "import('./scripts/lib/db.mjs').then(async({getDb})=>{const r=await getDb().execute('SELECT COUNT(*) AS n FROM tickers');console.log('tickers:', r.rows[0].n)})"
```

기대: `tickers: 60`

---

## 3. 이 프로젝트가 뭐 하려는 거였는지 (배경)

### 3.1 컨셉 피벗

**Before (구 컨셉, 다 제거 예정):**
- CWC v2 포트폴리오 시뮬레이터
- ₩10,000,000 + $10,000 가상자본으로 RSI/MA200 기반 mean-reversion + DCA 시뮬
- 페이지: `/`(시장), `/portfolio`, `/watchlist`, `/stats`

**After (지금 만드는 것):**
- 단일 종목 case-based 시뮬레이터
- 사용자가 종목 하나 검색·선택 → 과거 차트 + 미래 1·2·3개월 예측선
- 예측: "오늘의 시장 컨텍스트와 비슷했던 과거 일자들"을 찾아 그 종목의 평균 궤적
- 페이지: `/`(시장 유지), `/sim`(신규 단일 페이지)

### 3.2 핵심 의사결정 (이미 확정)

| 항목 | 결정 |
|---|---|
| 예상 그래프 시간축 | 미래 N일 예측 |
| 예측 방식 | Case-based (과거 유사 regime 사례 평균) |
| 매칭 키 | regime 라벨 + VIX 구간 |
| Horizon | 1·2·3개월 선택 가능 (30/60/90일) |
| DB | Turso (libSQL/SQLite, Tokyo region) |
| Retention | 5년 |
| 자동완성 | 빌드 시 `public/tickers-index.json` + 자작 prefix/substring |
| 차트 | Chart.js v4 (CDN), **수동 progressive draw** (`requestAnimationFrame`, 2초 타이핑 효과) |
| 종목 universe | 기존 60개 (KR 30 + US 30) MVP, 추후 KRX/Nasdaq 풀 확장은 별도 plan |

### 3.3 regime 라벨 / VIX band 매핑 (구현 시 참고)

기존 `scoreRegime` 의 `score` 정수값을 사용:
- `score ≥ 2` → `'bull'`
- `-1 ≤ score ≤ 1` → `'neutral'`
- `score ≤ -2` → `'bear'`

VIX band:
- VIX 있을 때 (US): `<15` → `low`, `15~25` → `mid`, `≥25` → `high`
- VIX 없을 때 (KR, vol20 기반): `<0.15` → `low`, `<0.30` → `mid`, else → `high`

---

## 4. 어디까지 했는가 (Task 1~4 완료)

브랜치 `feat/stock-simulation` 의 커밋 (최신 ↑):

```
bef691a feat(ingest): seed tickers from universe JSON      ← Task 4
544dc39 chore(astro): switch to hybrid output + serverless adapter  ← Task 3
174f16a feat(db): turso schema + apply script + libsql wrapper       ← Task 2
0cc55a1 chore(db): connection sanity check script
934d6d5 chore: add @libsql/client + Turso env template               ← Task 1
acb17ec docs(plan): 2026-05-28 종목 시뮬레이션 구현 계획
d13e6a0 docs(spec): 2026-05-28 종목 시뮬레이션 페이지 설계
```

### Task 1: Turso DB 프로비저닝 ✅
- Turso 가입, DB 생성 (이름 `surgepick`, location `nrt`)
- `.env.local` 에 `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` 설정
- Vercel + GitHub Actions Secrets 등록 끝
- `@libsql/client` + `dotenv` 설치
- `.env.local.example` 템플릿 커밋

### Task 2: DB 스키마 + 적용 스크립트 ✅
- `scripts/lib/db.mjs` — libsql wrapper (스크립트용, dotenv `.env.local` path 명시)
- `scripts/db/schema.sql` — DDL (tickers/prices/regime + 5 인덱스)
- `scripts/db/apply-schema.mjs` — 스키마 적용
- Turso 에 3 테이블 생성됨, 멱등 동작 확인
- **spec + quality review 모두 PASS**

### Task 3: Astro hybrid + 서버 라이브러리 ✅
- `astro.config.mjs`: `output: 'static'` → `'hybrid'`, adapter `vercel/static` → `vercel/serverless`
- `src/lib/db.mjs` — Astro 서버 라우트용 wrapper (`import.meta.env` 사용, dotenv 불필요)
- `src/pages/index.astro` 에 `export const prerender = true;` 추가
- 빌드 OK, dev 서버 응답 OK
- **spec + quality review PASS**

### Task 4: tickers ingest ✅ (review 보류)
- `scripts/ingest-tickers.mjs` — universe JSON → Turso `tickers`
- 실행: `✓ 60 tickers upserted` (KR 30 + US 30)
- **Implementer DONE, spec/quality review 미진행** — 다음 PC 에서 첫 작업: Task 4 review.

---

## 5. 무엇이 남았는가 (Task 5~20)

| # | Task | 상태 | 비고 |
|---|---|---|---|
| 4 | tickers ingest | ✅ DONE (review PASS) | plan 코드와 일치, 60건 upsert |
| 5 | Yahoo fetch open 필드 추가 | ✅ DONE | `parseChartResult` 에 `opens` 배열 추가, 파서 테스트 통과 |
| 6 | 가격 5년 backfill | ✅ 코드 DONE · 실행 대기 | `scripts/backfill-prices.mjs`. **실행은 Actions(§11)** — Yahoo 60종목 × 5y, ~15분 |
| 7 | 일일 가격 증분 | ✅ 코드 DONE · 실행 대기 | `scripts/ingest-prices.mjs`. `INSERT OR IGNORE` 멱등. `npm run scan` 에 포함 |
| 8 | regime ingest | ✅ 코드 DONE · 실행 대기 | `scripts/ingest-regime.mjs`. score→label/vix→band 변환 |
| 9 | tickers-index 빌드 + 파이프라인 | ✅ DONE | `build-tickers-index.mjs`(DB 실패 시 기존 파일 유지 fallback), package.json scripts, scan.yml+ingest.yml, 초기 `public/tickers-index.json`(universe 60종목) 커밋 |
| 10 | autocomplete 라이브러리 (TDD) | ✅ DONE | `src/lib/autocomplete.mjs` + `tests/autocomplete.test.mjs` 7개 통과 |
| 11 | predict 라이브러리 (TDD) | ✅ DONE | `src/lib/predict.mjs` + `tests/predict.test.mjs` 8개 통과. **matchCases 버그 수정**(아래 7.6) |
| 12 | `/sim` 페이지 스캐폴드 + 네비 | ✅ DONE | Base.astro 네비(시장/종목 시뮬레이션) + sim.astro |
| 13 | `/api/search` 라우트 | ✅ DONE | `src/pages/api/search.ts` SSR fallback |
| 14 | `/api/ticker` 라우트 | ✅ DONE | `src/pages/api/ticker.ts` — prices + predict forecast 반환 |
| 15 | TickerSearch 컴포넌트 | ✅ DONE | `src/components/TickerSearch.astro` 자동완성 + 키보드 |
| 16 | SimController + PriceTable | ✅ DONE | `src/components/{SimController,PriceTable}.astro` + horizon 토글 |
| 17 | ForecastChart (progressive draw) | ✅ DONE | Chart.js CDN(Base.astro) + `requestAnimationFrame` progressive draw |
| 18 | 수동 QA | **pending — 다음 진입점** | **Vercel preview 에서** `/sim` KR 3 + US 3 종목 + 모바일. 500 수정됐으니 이제 떠야 함 |
| 19 | 구버전 일괄 삭제 + 탭 통합 | ✅ DONE | portfolio/watchlist/stats + 옛 전략 코드/데이터/테스트 삭제. 홈(index)은 시장 카드만 남김. 탭 = 홈/시뮬레이션 2개. `market-comment.mjs` 는 scan-regime 의존이라 유지(plan 삭제목록 오류). HANDOFF.md 는 작업 진행중이라 유지 |
| 20 | spec archive + README 재작성 | ✅ DONE (2026-05-29) | 구 spec 8 + plan 6 → `docs/superpowers/archive/`, README 재작성. `npm test` 50 pass, `npm run build` OK |

### 이번 세션(2차)에 추가로 고친 것
- **Vercel 500**: `src/lib/db.mjs` 가 `import.meta.env` 로 Turso 자격증명을 읽어 런타임에 비어 500. → `process.env` 우선 + `import.meta.env` 폴백으로 수정.
- **Vercel 런타임 에러** (`invalid runtime nodejs18.x`): `@astrojs/vercel` v7.8.2 어댑터가 빌드노드 22 를 모르면 nodejs18.x 로 폴백 → Vercel 이 18 폐기. → `engines.node`=`20.x` + 빌드 후처리 `scripts/fix-vercel-runtime.mjs` 가 함수 runtime 을 `nodejs20.x` 로 강제(build script 에 포함).
- **탭 통합**: Base.astro 네비 = 홈(/) · 시뮬레이션(/sim) 두 개.

---

## 6. 다음 PC 에서 처음 할 일 (순서대로)

### 6.1 슬래시 커맨드 진입

새 세션에서 Claude Code 켜고:

```
/superpowers:subagent-driven-development
```

(이미 이전 세션에서 brainstorming → writing-plans → subagent-driven 까지 진입한 상태. 새 세션은 처음부터 다시 시작하므로 skill 도 다시 invoke 해야 함. 또는 단순히 "HANDOFF.md 읽고 Task 4 review 부터 진행해줘" 라고 시작해도 됨.)

### 6.2 첫 메시지 예시 (그대로 복사해서 보내도 됨)

```
HANDOFF.md 읽었어. feat/stock-simulation 브랜치, Task 4~17+19 끝났고 다음은 Task 18 QA + Task 20 문서.
먼저 .env.local 에 Turso 자격증명 채우고(§2.3) npm install → npm run build/test 로 환경 확인하고,
npm run dev 로 /sim 직접 QA(삼성/AAPL 검색→차트). 잘 되면 Task 20(구 spec archive + README 재작성) 마무리하고
PR 또는 main merge 준비해줘.
```

남은 작업:
1. **Task 18 QA** — `npm run dev` 또는 Vercel preview 에서 `/sim` 실동작 (검색→예측 차트, 1/2/3M 토글, KR+US). regime 표본 적으면 "표본 부족" 정상.
2. **Task 20** — 구 spec 8 + plan 6 → `docs/superpowers/archive/`, README 재작성 (plan 파일 Task 20 에 README 본문 그대로 있음).
3. (선택) regime 과거 backfill — predict 가 "표본 부족" 자주 뜨면 §7.4 참고.
4. PR/merge — QA 통과 후 `feat/stock-simulation` → `main`.

### 6.3 Task 5 부터의 진행 패턴

각 task 마다:
1. Implementer 디스패치 (`backend` subagent, plan 의 task 텍스트 그대로 전달)
2. Implementer DONE 보고
3. Spec compliance + code quality review (단순 task 는 1회 묶어서, 복잡 task 는 2회 분리)
4. PASS → 다음 task
5. FAIL → implementer 재디스패치하여 수정

---

## 7. 주의사항 / 함정

### 7.1 dotenv `.env.local` path
- Node 스크립트에서 dotenv 쓸 때 `import 'dotenv/config'` 만 쓰면 **`.env.local` 을 무시함**.
- 반드시 `import { config } from 'dotenv'; config({ path: '.env.local' });`
- 이미 `scripts/lib/db.mjs` 와 `scripts/db/check-connection.mjs` 에 적용됨. 새 스크립트 추가 시 동일 패턴.
- Astro 서버 라이브러리 (`src/lib/db.mjs`) 는 `import.meta.env` 로 읽으므로 dotenv 불필요.

### 7.2 Astro 4 hybrid 모드
- 기존 페이지 (`/`, `/portfolio` 등) 는 `export const prerender = true;` 명시되지 않아도 정적으로 산출됨 (hybrid 기본).
- `/sim` 페이지는 `export const prerender = false;` 로 명시해야 API 라우트 컨텍스트 활성화.

### 7.3 종목 `ticker` 형식
- KR 종목은 `005930.KS` 형식 (Yahoo Finance 호환).
- US 종목은 `AAPL` 형식.
- DB 의 `ticker` 컬럼은 위 형식 그대로 저장 — 사용자에게 보일 때만 짧게 (e.g. `'005930.KS'.replace(/\.[A-Z]+$/, '')` → `'005930'`)

### 7.4 regime 셀 표본 부족 (운영 1주일 내)
- 일일 regime 이 매일 1줄씩 누적되므로 운영 초기에는 셀(market × label × vix_band = 9개) 대부분이 0~1건.
- 이 경우 `predict()` 가 `insufficient_cases` 에러 반환 → UI 에 "표본 부족" 메시지.
- **임시 해결 옵션 (Plan 외 follow-up task)**: `scripts/backfill-regime.mjs` 를 만들어 KOSPI/SPX 5년 일별 close 로 과거 regime 일별 재구성. 사용자 결정에 따라 추가.

### 7.5 Chart.js progressive draw
- Task 17 의 핵심 — 사용자가 명시적으로 요구한 효과 ("선이 없다가 그려져 나가야돼").
- 구현: `animation: false` + `requestAnimationFrame` 으로 매 프레임 한 포인트씩 `chart.data.datasets[i].data.push()` 후 `chart.update('none')`.
- `prefers-reduced-motion: reduce` 환경에서는 즉시 그리기.
- Chart.js v4 + chartjs-adapter-date-fns CDN 사용 (npm 의존성 추가 X).

### 7.6 Task 11 구현 중 발견·수정한 plan 버그 (이미 반영됨)
- **matchCases vix_band fallback 버그**: plan 의 `predict` 는 fallback 시 `matchCases(..., { ...ctx, vix_band: undefined })` 로 vix_band 제약을 풀려 했지만, `matchCases` 가 `r.vix_band === ctx.vix_band` 엄격비교라 `'low' === undefined` → 전부 제외되어 fallback 이 항상 빈 결과였음. → `matchCases` 를 `(ctx.vix_band == null || r.vix_band === ctx.vix_band)` 로 수정. exact 매칭(vix_band 지정 시)은 영향 없음.
- **plan 의 predict 테스트 `today: '2024-06-01'` 모순**: 픽스처 prices 는 2024-01~04 만 생성하는데 today 가 06-01 이라 `no_today_close` 로 조기 리턴됨. → today 를 시리즈에 실재하는 `'2024-04-10'` 로 교정 (의도 동일).
- **normalizeTrajectory 첫 테스트 `toEqual([0, 0.1, 0.21])`**: 부동소수점(`1.1 - 1 !== 0.1`)으로 깨짐 → 다른 케이스처럼 `toBeCloseTo` 로 작성.
- **테스트 위치 컨벤션**: plan 은 `src/lib/*.test.ts` co-located 를 제시했으나, vitest.config 가 `tests/**/*.test.mjs` 만 include 하고 기존 18개 테스트도 그 컨벤션이라 **`tests/*.test.mjs`** 로 작성함. 라이브러리 본체는 plan 대로 `src/lib/*.mjs`.

---

## 8. 참고 파일

| 경로 | 역할 |
|---|---|
| `docs/superpowers/specs/2026-05-28-stock-simulation-design.md` | 전체 설계 |
| `docs/superpowers/plans/2026-05-28-stock-simulation.md` | 20 task 단계별 구현 가이드 (각 step 별 코드 포함) |
| `HANDOFF.md` | 이 문서 (Phase 6 Task 19 에서 삭제 예정 — 그때까지 유지) |
| `scripts/universe-kr.json` / `universe-us.json` | 시작 종목 60개 |
| `scripts/scan-regime.mjs` | regime 계산 (Phase 1 유지, ingest-regime 이 결과를 DB 로 옮김) |
| `scripts/fetch-yahoo.mjs` | Yahoo Finance 클라이언트 (Task 5 에서 open 필드 추가) |
| `.env.local.example` | Turso env 템플릿 |

---

## 9. 푸시 상태

`feat/stock-simulation` 브랜치 origin 에 push 완료. PR 은 아직 안 만들었음 — 모든 task 끝나고 Task 20 후 PR 또는 main merge.

Vercel preview 자동 배포가 트리거됐을 수 있음. preview URL 확인: Vercel 대시보드.

---

## 10. 의존성·환경 버전 (재현용)

- Node 20 LTS (Astro 6 / Node 22 는 아직 안 옴)
- Astro 4.16.x
- Tailwind 3.4.x
- `@libsql/client` 0.14+
- `@astrojs/vercel` ^7.8.2 (sub-export `serverless` 사용)

`package.json` `engines` 가 `>=20` 으로 잡혀있음.

---

## 11. 데이터 적재 실행 (GitHub Actions)

Claude 웹 실행환경은 네트워크 allowlist 가 Turso·Yahoo 를 막아서(403) 컨테이너 안에서 직접 적재가 안 됨. 대신 두 가지 길:

### 길 A — GitHub Actions (모바일 OK, 권장)
전제: repo Settings → Secrets and variables → Actions 에 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` 등록돼 있어야 함 (등록됨).
1. GitHub → repo → **Actions** 탭 → 좌측 **"Initial data ingest (manual)"** 워크플로 선택
2. **Run workflow** 버튼 → branch `feat/stock-simulation` 선택 → 실행
3. ~15분 후 완료. `ingest.yml` 이: tickers seed → 5y backfill → 오늘 regime → 인덱스 재생성 → (변경 시) 커밋·푸시
4. 이후 매일은 `scan.yml`(스케줄)이 regime+증분가격을 DB 에 적재 (TURSO secrets env 추가됨)

### 길 B — Claude 웹 환경 네트워크 열기 (PC 브라우저)
claude.ai/code 환경 편집 → Network access = **Custom** → Allowed domains 에 `*.turso.io`, `query1.finance.yahoo.com`, `query2.finance.yahoo.com` 추가(+ 기본 목록 포함 체크) → env vars 에 TURSO 2개 등록 → 세션 재시작 → `npm run ingest:tickers && npm run backfill:prices && npm run scan:regime && npm run ingest:regime && npm run build:index` 직접 실행.

### 적재 검증 (어느 길이든 후)
```bash
node -e "import('./scripts/lib/db.mjs').then(async({getDb})=>{const d=getDb();for(const t of['tickers','prices','regime']){const r=await d.execute('SELECT COUNT(*) n FROM '+t);console.log(t, r.rows[0].n)}})"
```
기대: tickers 60 / prices ~75,000 / regime ≥2

적재가 끝나면 **Task 12(/sim 페이지 스캐폴드 + 네비)** 부터 UI 진행. Task 13·14 API 라우트는 런타임에 DB 를 읽으므로 Vercel(secrets 등록됨)에서 동작.

---

피곤한 거 끝났으면 잘 자. 새 PC 에서 자연스럽게 이어 갈 수 있을 거야.
