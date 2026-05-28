# surgePick — 급등 후보 + 시장 국면/비중 가이드

작성일: 2026-05-26
상태: Draft (구현 계획 작성 대기)

## 1. 목적

투자자가 매일 한 번 모바일로 열어 두 가지 의사결정에 쓰는 버튼 기반 웹사이트.

1. **급등픽 생성기** — `[오늘의 픽 보기]` 버튼 → "급등 없이 점진 우상향 + 거래량 증가 + 하단 매집" 패턴에서 한국 **1개** + 미국 **1개** 종목 (매일 1쌍). 알고리즘이 종목 특성으로 **단기/중기/장기** 호라이즌 자동 분류. 추천 한 줄. 매일 누적되어 히스토리 목록·상세 페이지에서 수익률 추적.
2. **시장 온도계** — `[지금 시장 어때?]` 버튼 → 공포지수(VIX) + 4시장 카드(각 카드 안에 60일 지수 차트 + MA50/MA200 오버레이) + 종합 비중 + **테마 분위기 섹션** (KR/US 각 16개 테마 마스터 풀에서 매일 자동 선정한 8 인기 + 8 투자가치 테마, 가로 스와이프 carousel, 기본 4개 노출). 결론: 풀매수/분할매수/관망/축소 + 권장 주식 비중.

**모바일 우선**. 1열 카드 레이아웃, 큰 탭 영역, 빠른 로딩.

매매 자동 실행, 푸시 알림, 로그인은 범위 밖.

## 2. 비범위

- 실시간 시세, 분봉, 호가창
- 로그인, 워치리스트, 개인 포트폴리오 저장
- 자동 매매, 알림(이메일/Push)
- 종목 토론, 커뮤니티
- 모바일 앱

## 3. 사용자 흐름

1. 모바일에서 사이트 접속 (`/`). 단일 페이지(SPA 아님, 정적 Astro 페이지)에 두 개의 큰 버튼이 보임.
   - `[오늘의 급등픽]`
   - `[지금 시장 어때?]`
2. 데이터 기준 시각(asOf)이 상단에 작게 표시.
3. `[오늘의 급등픽]` 탭 → 한국 1개 카드 + 미국 1개 카드 + "히스토리 보기" 링크. 카드: 종목명·티커, 스파크라인, 호라이즌 뱃지(단기·중기·장기), 한 줄 추천 이유.
3-1. 히스토리 페이지(`/history`) → 누적 픽 목록. 컬럼: 매수일, 종목, 매수가, 현재가, 수익률, 호라이즌, 상태(보유중·매도완료).
3-2. 픽 상세(`/picks/[id]`) → 추천 당시 이유, 진입 시점 30일 차트, 호라이즌, 만기 매도 시 수익률 확정 값.
4. `[지금 시장 어때?]` 탭 → 공포지수 카드 + 4시장 카드(라벨·비중·**지수 차트 60일+MA50/MA200**) + 종합 권장 비중 + **테마 분위기 섹션**(탭 [인기]/[투자가치], 시장별 가로 스와이프 carousel).
5. 버튼은 두 번째 클릭 시 토글로 닫힘 (다시 누르면 숨김). 한 번에 한 섹션만 펼침.

## 4. 아키텍처

### 4.1 스택

- **프레임워크**: Astro 4, **hybrid 출력** (정적 페이지 + SSR 가능한 동적 라우트 `/picks/[id]`)
- **스타일**: Tailwind CSS
- **차트**: 자체 SVG 컴포넌트
- **언어**: TypeScript (Astro), Node ESM (`.mjs`) 스크립트
- **데이터 페치**: Yahoo `query1.finance.yahoo.com/v8/finance/chart/`
- **영속 저장**: **Vercel KV** (Redis 호환). 키:
  - `picks:history` — 누적 픽 배열
  - `picks:latest` — 마지막 스캔 결과 캐시
- **배포**: Vercel
- **갱신**: 수동 `npm run scan` v1. 향후 Vercel Cron.

### 4.2 디렉터리

```
surgePick/
  scripts/
    scan-picks.mjs        # 급등 후보 발굴
    scan-regime.mjs       # 시장 국면 판정
    universe-kr.json      # KOSPI/KOSDAQ 티커 마스터
    universe-us.json      # S&P500/NASDAQ100 티커 마스터
  scripts/
    themes-kr.json            # KR 테마 마스터 풀 (30+ 테마, 테마당 5~10 종목)
    themes-us.json            # US 테마 마스터 풀 (30+ 테마)
    scan-themes.mjs           # 테마 스캐너 → src/data/themes.json
    sync-history.mjs          # KV → src/data/picks-history.json 미러 (빌드 전)
    lib/
      theme-select.mjs        # 마스터 풀 → 일별 인기/투자가치 8+8 선정
      horizon.mjs             # 호라이즌(단/중/장) 자동 분류
      kv-client.mjs           # Vercel KV thin wrapper (read/write/append)
  src/
    data/
      picks.json              # 오늘의 픽 1+1
      picks-history.json      # KV 미러 (빌드용)
      regime.json             # 공포지수 + 4시장 국면 + 지수 시계열
      themes.json             # 16 KR + 16 US 테마 선정 결과
    components/
      ActionButton.astro      # 큰 토글 버튼
      PickCard.astro          # 종목 카드
      Sparkline.astro         # 작은 라인 차트
      IndexChart.astro        # 60일 지수 + MA50/MA200 (4시장 카드 내부)
      FearGaugeCard.astro     # 공포지수 게이지
      MarketMoodCard.astro    # 시장별 분위기 카드 (IndexChart 포함)
      OverallCard.astro       # 종합 비중 카드
      ThemeCard.astro         # 테마 카드 (미니 차트 + 라벨 + 한 줄)
      ThemeCarousel.astro     # 가로 스와이프 carousel (스냅 스크롤)
      ThemeTabs.astro         # 인기/투자가치 탭 전환
    scripts/
      toggle.ts               # 버튼 토글
      theme-tabs.ts           # 테마 탭 전환
    pages/
      index.astro             # 홈 (두 버튼 토글)
      history.astro           # 픽 히스토리 목록
      picks/
        [id].astro            # 픽 상세 (정적 prerender; getStaticPaths)
    layouts/
      Base.astro
  astro.config.mjs
  tailwind.config.mjs
  package.json
  tsconfig.json
```

### 4.3 데이터 흐름

```
[Yahoo chart endpoint]
        │  (일봉 60~120일, 종가·거래량)
        ▼
  scan-picks.mjs ── 알고리즘 ──▶ src/data/picks.json
  scan-regime.mjs ── 지표  ──▶ src/data/regime.json
        │
        ▼
   Astro 빌드  ──▶  정적 페이지 (Vercel)
```

스크립트는 빌드 전에 수동 또는 cron으로 실행. JSON이 페이지에 정적으로 임베드되므로 런타임 API 호출 없음.

## 5. 데이터 수집

### 5.1 유니버스

- **KR**: KOSPI + KOSDAQ 전 종목. v1은 `scripts/universe-kr.json`에 정적 리스트(약 2,500개). 초기 시드는 KRX 공식 종목 마스터에서 한 번 수동 추출하거나 `yahoo-finance2 search` API로 시드. 분기에 한 번 갱신.
- **US**: S&P500 + NASDAQ100 (중복 제외 약 530개). `scripts/universe-us.json`. 초기엔 정적 리스트, 분기 갱신.

유니버스 자동 갱신은 v2 항목.

### 5.2 페치 전략

- Yahoo chart endpoint: `GET https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=R`
  - 픽 스캐너: `range=4mo` (60거래일 + 버퍼)
  - 국면 스캐너: `range=1y` (MA200 계산에 200거래일 필요)
  - lincoln-brief의 `fetchChartDirect`를 그대로 차용. crumb 인증 불필요.
  - 응답에서 `closes`, `volumes`, `highs`, `lows` 추출.
- 호출 간격 200ms (Yahoo 429 회피). 픽 유니버스 2,500 + 530 = 약 3,030 종목 × 200ms ≈ 10분. 국면은 지수 6개(`^KS11`, `^KQ11`, `^GSPC`, `^IXIC`, `^VIX`, + 백업)만 호출하므로 수 초.
- 실패한 티커는 `available: false`로 마킹하고 스코어 계산에서 제외.
- 모든 페치 실패 시 기존 JSON 보존(lincoln-brief 패턴).

### 5.3 KRX OpenAPI (선택)

KRX 인증 키를 받는다면 외국인/기관 순매수, 거래대금 데이터를 추가해 "매집" 신호를 강화할 수 있음. v1은 사용 안 함. `KRX_API_KEY` 환경변수 존재 시 자동 활성화하는 자리만 마련.

## 6. 알고리즘

### 6.1 급등 후보 발굴 (`scan-picks.mjs`)

입력: 종목별 최근 60거래일 종가 `closes[60]`, 거래량 `volumes[60]`.

세 조건을 각각 0~1로 정규화한 뒤 가중 합산. 세 조건 모두 임계 통과 + 종합 스코어 상위 20개 선정.

**조건 A — 완만 우상향 (no spike, trending up)**

- `slope = linearRegression(closes[-30:]).slope / closes[-30]` (일 평균 수익률)
- `maxDailyReturn = max((close[i] - close[i-1]) / close[i-1] for i in last 30)`
- `spikeCount = count(daily_return >= 0.05 for last 30 days)`
- 통과 조건: `slope > 0.001` (일평균 0.1%↑) AND `maxDailyReturn < 0.07` AND `spikeCount <= 2`
- 점수: `score_A = clamp(slope / 0.005, 0, 1) * (1 - spikeCount / 3)`

**조건 B — 거래량 증가**

- `vol_first_half = mean(volumes[-30:-15])`
- `vol_second_half = mean(volumes[-15:])`
- `volRatio = vol_second_half / vol_first_half`
- `volSlope = linearRegression(log(volumes[-30:])).slope`
- 통과 조건: `volRatio >= 1.3` AND `volSlope > 0`
- 점수: `score_B = clamp((volRatio - 1) / 1.0, 0, 1)`

**조건 C — 하단 매집**

- `high30 = max(highs[-30:])`, `low30 = min(lows[-30:])`
- `pricePosition = (close[-1] - low30) / (high30 - low30)`  // 0=바닥, 1=고점
- OBV(누적 거래량) 계산: 일별로 `close > prev_close ? +volume : -volume` 누적
- `obvSlope = linearRegression(obv[-30:]).slope`
- `obvSlopeNormalized = clamp(obvSlope / mean(volumes[-30:]), 0, 1)` — 거래량 평균 대비 일평균 OBV 증가율을 0~1로 클램프
- 통과 조건: `pricePosition <= 0.4` AND `obvSlope > 0`
- 점수: `score_C = (1 - pricePosition) * obvSlopeNormalized`

**종합**

- 세 통과 조건 모두 만족 → 후보군에 포함
- `total = 0.35 * score_A + 0.30 * score_B + 0.35 * score_C`
- **시장별(KR/US) Top 1 선정** (매일 1쌍).

**호라이즌 자동 분류**:

각 픽에 대해 점수 패턴과 변동성으로 단기/중기/장기 중 하나 할당.

```
if score_A >= 0.6 AND mom1m >= 0.04:
    horizon = '단기'    # 추세·모멘텀 강함 → 2주 차익실현
elif score_C >= 0.5 AND vol20 <= 0.25 AND obvSlopeNormalized >= 0.5:
    horizon = '장기'    # 저점 매집·낮은 변동성 → 1년 보유
else:
    horizon = '중기'    # 균형형 → 3개월
```

호라이즌별 보유기간:
- 단기: 14일
- 중기: 90일  
- 장기: 365일

**추천 이유 한 줄 생성**: 가장 강한 점수 한두 개를 사용자 친화 문구로 조합. 예시:
- "30일간 천천히 우상향, 거래량은 1.6배로 늘었음. 누군가 조용히 모으는 중."
- "바닥권에서 거래량 증가 — 매집 신호."
- "변동성 작게 우상향 + 거래량 30일 평균 위. 안정적 흐름."

문구는 템플릿 3~5개에서 통과한 조건 조합으로 선택. 전문 용어(OBV, slope) 노출 금지.

### 6.2 시장 국면 + 비중 (`scan-regime.mjs`)

대상 지수: `^KS11` (KOSPI), `^KQ11` (KOSDAQ), `^GSPC` (S&P500), `^IXIC` (NASDAQ).

지수별로 다음 지표 계산 (최근 200일 종가 필요):

- **추세**: `close[-1] > MA50 > MA200` → trendUp, `close[-1] < MA200` → trendDown, 그 외 chop
- **모멘텀**: `mom1m = close[-1] / close[-21] - 1`, `mom3m = close[-1] / close[-63] - 1`
- **변동성**: `vol20 = stdev(daily_returns[-20:]) * sqrt(252)` (연환산)
- **공포지표**: US는 `^VIX` 종가 사용. KR은 VIX 항목 없음 → 동등하게 다루기 위해 `vol20`을 공포지표로 재사용(아래 임계값 다름).
- **폭 breadth** (옵션, v1 생략): % of universe with `close > MA200`. 비싼 계산이므로 v1은 추세+모멘텀+변동성+공포지표만으로 판정.

**판정 로직** (각 시장 독립, KR/US 동일 점수 범위):

공통 가점:
```
trendUp → +2,  trendDown → -2,  chop → 0
mom1m > 0.02 → +1;  mom1m < -0.02 → -1
mom3m > 0.05 → +1;  mom3m < -0.05 → -1
```

공포지표 (US):
```
VIX < 18 → +1
VIX > 25 → -1
```

공포지표 (KR — VIX 부재):
```
vol20 < 0.15 → +1
vol20 > 0.30 → -1
```

→ 양쪽 다 최대 +4, 최소 -4 범위. 시장 간 비교 가능.

총점 → 라벨/권장 주식 비중:

| 총점 | 라벨 | 권장 주식 비중 |
|------|------|-----------------|
| ≥ +3 | 풀매수 | 90~100% |
| +1 ~ +2 | 분할매수 | 60~80% |
| -1 ~ 0 | 관망/존버 | 40~60% |
| ≤ -2 | 비중축소 + 이익실현 | 10~30% |

**공포지수 단계화** (사용자 친화 표현):

전역 공포지수 카드는 **VIX 기준**으로 단계 판정 (VIX가 세계 표준 공포 지표). KR 변동성(vol20)은 KR 시장 카드 내부 점수 계산에만 사용. 게이지에는 VIX 숫자 + 5단계 도트만 노출.

| VIX 범위 (US) / vol20 (KR) | 단계 | 색상 | 한 줄 |
|------|------|------|------|
| VIX < 14 / vol < 0.12 | 극도의 탐욕 | 🔴 진빨강 | "시장 너무 들떠 있음. 과열 조심." |
| 14~18 / 0.12~0.18 | 탐욕 | 🟠 주황 | "분위기 좋음. 위험 자산 강세." |
| 18~22 / 0.18~0.22 | 중립 | 🟡 노랑 | "평소 수준. 평범한 시장." |
| 22~28 / 0.22~0.28 | 공포 | 🔵 파랑 | "겁먹기 시작. 신중하게." |
| VIX > 28 / vol > 0.28 | 극도의 공포 | 🟣 보라 | "공포 극심. 이럴 때 바닥 만들어짐." |

**시장 한 줄 코멘트** (전문 용어 없이):

분기별 템플릿 예시:
- 풀매수: "추세 강하고 변동성 작음. 지금은 적극 들고 가도 됨."
- 분할매수: "방향은 위지만 흔들림 있음. 한 번에 다 넣지 말고 나눠서."
- 관망/존버: "방향 애매. 무리해서 사지도 팔지도 말고 가만히."
- 비중축소: "추세 꺾이고 공포 커짐. 일부 현금화하고 이익 챙겨둘 때."

해설은 점수에 기여한 지표를 평이한 한국어로 풀이.
예: "S&P500: 추세 위, 한 달 +3.1%, 공포지수 14.2(탐욕). 분위기 좋으니 85%까지 들고 가도 OK."

### 6.4 픽 히스토리 + 수익률 트래킹 (`scan-picks.mjs` + Vercel KV)

**저장 키 구조** (Vercel KV):

- `picks:history` — JSON 배열. 각 엔트리:
  ```json
  {
    "id": "kr-2026-05-26-005930",
    "market": "KR",
    "ticker": "005930.KS",
    "name": "삼성전자",
    "buyDate": "2026-05-26",
    "buyPrice": 74500,
    "horizon": "단기",
    "holdDays": 14,
    "matureDate": "2026-06-09",
    "reason": "30일간 천천히 우상향, 거래량 1.6배 증가. 매집.",
    "metricsAtEntry": { /* score breakdown */ },
    "closes30AtEntry": [/* 30일 종가 스냅샷 */],
    "currentPrice": 74500,
    "currentDate": "2026-05-26",
    "returnPct": 0,
    "status": "holding",
    "sellDate": null,
    "sellPrice": null
  }
  ```

**스캔 시 동작** (`scan-picks.mjs`):

1. **신규 픽 생성**: KR/US 각각 Top 1 선정 → 호라이즌 분류 → `buyPrice = 오늘 종가`, `matureDate = buyDate + holdDays(거래일이 아닌 달력일)` → `status='holding'` → KV append.
2. **활성 픽 갱신**: `picks:history` 중 `status='holding'` 엔트리 전체에 대해:
   - 해당 종목 현재가 페치 (배치)
   - `currentPrice`, `currentDate`, `returnPct = (currentPrice - buyPrice) / buyPrice * 100` 갱신.
   - `today >= matureDate` 이면:
     - `status = 'sold'`
     - `sellDate = today`
     - `sellPrice = currentPrice` (만기 시점 종가)
     - 이후 갱신 중지(수익률 고정).
3. **중복 방지**: 같은 buyDate에 이미 동일 market 픽이 있으면 신규 생성 스킵 (멱등).

**KV 비어있을 때**: 첫 스캔에서 빈 배열로 초기화.

### 6.5 테마 분위기 (`scan-themes.mjs` + `theme-select.mjs`)

**테마 마스터 풀** (`themes-kr.json`, `themes-us.json`):
- 시장별 30+ 테마. 테마당 `{ id, name, icon, tickers:[], category:'popular'|'value'|'both' }`.
- 카테고리 힌트만 제공 — 실제 노출 카테고리는 매일 점수로 결정.

**테마별 시계열 합성**:
- 구성 종목들의 일별 종가를 첫날=100 기준 정규화 후 평균 → 테마 인덱스 시계열.
- 결측 종목은 평균에서 제외.

**점수 계산**: 테마 인덱스에 §6.2 `scoreRegime` 그대로 적용 (KR/US 따라 vix 또는 vol20).

**일별 자동 선정** (`theme-select.mjs`):
- 각 시장 마스터 풀의 모든 테마에 대해 `scoreRegime` + 모멘텀(mom1m + mom3m) 계산.
- **인기 8**: 모멘텀 점수(`mom1m * 0.4 + mom3m * 0.6`) 내림차순 Top 8.
- **투자가치 8**: `score >= 1 AND vol20 < 0.25 AND mom3m > -0.05` 필터 통과 후 `score` 내림차순 Top 8 — 인기 8과 중복 시 인기에 양보, 나머지로 보충.
- 시장별 16 = 8 + 8. 양 시장 합 32.

**테마 카드 코멘트** (사용자 친화):
- 라벨 + 비중 (§6.2 매핑 그대로).
- 한 줄 예: "AI: 한 달 +12%, 추세 강함. 분할매수 권장." / "은행: 변동성 작고 꾸준한 흐름. 안정 비중."

**카테고리별 카드 색**: 인기=주황 계열 액센트, 투자가치=청록 계열 액센트.

## 7. UI 사양

### 7.1 단일 페이지 `/` — 모바일 우선

레이아웃: 폭 100%, 1열, 큰 탭 영역 (≥44px), 카드 간 큰 여백.

**상단**
- 사이트명 + 작은 asOf 시각 표시
- 큰 버튼 2개 세로 스택 (모바일) / 가로 (데스크탑 ≥640px):
  - `[📈 오늘의 급등픽]` — 파랑 계열
  - `[🌡️ 지금 시장 어때?]` — 주황 계열
- 버튼 영역 높이 ≥ 64px, 한 손 엄지로 누르기 쉽게.

**버튼 클릭 동작**
- 정적 JSON은 페이지 로드 시 이미 임베드. 클릭은 섹션 노출 토글만 수행 (네트워크 호출 없음).
- 한 섹션만 열림 — 다른 버튼 누르면 이전 섹션 접힘.
- 부드러운 펼침 애니메이션 (transform/opacity, 200ms).

**급등픽 섹션 (펼침 시)**

```
[한국]
 ┌─────────────────────────┐
 │ 005930.KS  삼성전자       │
 │ ┌──── sparkline ────┐   │
 │ │                      │  │
 │ └──────────────────┘  │
 │ "30일간 천천히 우상향,    │
 │  거래량 1.6배 증가. 매집" │
 └─────────────────────────┘
 (3개 카드)

[미국]
 (3개 카드 동일 형식)
```

각 카드:
- 종목명 + 티커
- 30일 스파크라인 (SVG, 그라데이션, 높이 60px)
- 한 줄 추천 이유 (사용자 친화 문구, 16~18px, 줄바꿈 OK)
- 종합 스코어 0~100 (작게 우측 상단)

빈 결과: "오늘은 조건 충족 종목 없음. 내일 다시 확인." 한 줄.

**시장 온도계 섹션 (펼침 시)**

```
 ┌─────────────────────────┐
 │ 🌡️ 공포지수 VIX 14.2     │
 │  ●●○○○  탐욕              │
 │ "분위기 좋음. 위험 자산  │
 │  강세."                  │
 └─────────────────────────┘

 ┌─────────────────────────┐
 │ 🇰🇷 코스피  분할매수·70%  │
 │  ╱‾‾╲   ╱●               │
 │ ╱    ╲╱       ← 지수 60일│
 │ ⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯   MA50      │
 │ ─────────────  MA200    │
 │ "방향은 위지만 흔들림."  │
 └─────────────────────────┘
 (KOSDAQ, S&P500, NASDAQ 동일)

 ┌─────────────────────────┐
 │ 💡 종합 70~85%           │
 │ "글로벌 분위기 양호..."  │
 └─────────────────────────┘

 ─────────────────────────

 📊 테마 분위기
 [인기]  [투자가치]          ← 탭

 🇰🇷 한국
 ┌──┐┌──┐┌──┐┌──┐ ◀▶      ← 가로 carousel
 │반│ │2 │ │AI │ │바 │       (4 visible, 8 total)
 │도│ │차│ │  │ │이 │
 │체│ │전│ │  │ │오 │
 └──┘└──┘└──┘└──┘
 🇺🇸 미국
 ┌──┐┌──┐┌──┐┌──┐ ◀▶
 │AI│ │반│ │EV │ │클 │
 └──┘└──┘└──┘└──┘
```

- 공포지수 카드 최상단.
- 4시장 카드 각각 내부에 **60일 지수 라인** + MA50(점선) + MA200(실선) 오버레이. 현재가는 끝점 ●. 차트 높이 80px.
- 종합 카드.
- 구분선 후 테마 섹션.

**테마 섹션 상세**

- 탭: `[인기]` `[투자가치]` — 둘 중 하나 활성. 기본 `[인기]`.
- 시장별 가로 스크롤 carousel:
  - `scroll-snap-type: x mandatory` + `scroll-snap-align: start`로 카드 단위 스냅
  - 모바일 기본 4개 시야 (각 카드 폭 ≈ 22vw, gap 8px)
  - 양 끝에 `◀ ▶` 힌트(데스크탑 표시, 모바일은 스와이프로 발견)
- 각 테마 카드:
  - 상단: 테마 아이콘 + 이름 (예: "🔋 2차전지")
  - 중단: 60일 미니 차트 (테마 평균가, 30px 높이)
  - 하단: 라벨 + 권장 비중% (작게)
  - 한 줄 코멘트 (2줄까지 줄바꿈, ellipsis)
- 인기 vs 투자가치 시각 구분:
  - 인기 탭 카드: 좌측 액센트 바 주황(`#f97316`)
  - 투자가치 탭 카드: 좌측 액센트 바 청록(`#14b8a6`)

**푸터**
- "투자 판단의 참고용. 매수/매도 추천 아님." 면책
- "Source: Yahoo Finance"
- asOf 시각 재표시

### 7.2 히스토리 페이지 `/history`

- 모바일 1열 리스트, 데스크탑 2열 그리드.
- 헤더: "픽 히스토리" + 상태 필터 탭 `[전체][보유중][매도완료]`
- 호라이즌 필터 칩: `[단기][중기][장기]`
- 각 행:
  - 매수일 (YYYY-MM-DD)
  - 종목명 + 티커
  - 호라이즌 뱃지 (단기=노랑 / 중기=파랑 / 장기=초록)
  - 매수가 / 현재가 (또는 매도가) — 통화 자동 (KRW/USD)
  - 수익률 색상 표시 (양수=초록, 음수=빨강)
  - 상태 뱃지 (보유중=회색 / 매도완료=청록)
- 정렬: 최신순 기본. 클릭 시 수익률순 토글.
- 각 행 클릭 → 상세 페이지.

### 7.3 픽 상세 `/picks/[id]`

- 헤더: 종목명 + 티커 + 호라이즌 뱃지
- 진입 시점 30일 차트 (`closes30AtEntry`)
- 현재가 + 수익률 (큰 표시)
- 매수일 / 매수가 / 만기일 / 보유기간(D-X 카운트다운)
- "이 종목을 추천한 이유" 블록 — 진입 당시 사용자 친화 문구 + 보조 풀이:
  - 추세: 일평균 X% 우상향, 급등 없음
  - 거래량: N배 증가
  - 매집: 가격 위치(저점에서 X%)
- 매도완료 상태인 경우: 매도일 + 매도가 + 확정 수익률 강조.

### 7.4 별도 페이지 — `/regime` 없음

시장 국면은 `/` 펼침 섹션에 그대로. 별도 라우트 안 만듦.

## 8. 정적 데이터 스키마

### 8.1 `picks.json` (시장당 1개 — 오늘의 픽)

오늘 추천된 픽 미러. 항상 KV의 마지막 2개(KR + US 가장 최근)와 동일.

```json
{
  "asOf": "2026-05-26T16:30:00+09:00",
  "kr": {
    "id": "kr-2026-05-26-005930",
    "ticker": "005930.KS",
    "name": "삼성전자",
    "horizon": "단기",
    "score": 78,
    "closes30": [...],
    "reason": "30일간 천천히 우상향, 거래량 1.6배 증가. 매집."
  },
  "us": {
    "id": "us-2026-05-26-AAPL",
    "ticker": "AAPL",
    "name": "Apple",
    "horizon": "중기",
    "score": 72,
    "closes30": [...],
    "reason": "바닥권에서 거래량 증가 — 매집 신호."
  }
}
```

조건 통과 종목이 없는 시장은 `null`. UI에서 "오늘은 조건 충족 종목 없음" 처리.

### 8.1.1 `picks-history` (Vercel KV) — §6.4 형식 그대로

KV에 저장된 누적 픽. 빌드 시 한 번 동기화하여 `src/data/picks-history.json` 미러 생성 → 정적 페이지 렌더용.

### 8.2 `regime.json`

```json
{
  "asOf": "2026-05-26T16:30:00+09:00",
  "fearGauge": {
    "vix": 14.2,
    "krVol20": 0.18,
    "level": "탐욕",
    "step": 2,
    "color": "orange",
    "comment": "분위기 좋음. 위험 자산 강세."
  },
  "markets": [
    {
      "code": "KOSPI",
      "emoji": "🇰🇷",
      "label": "분할매수",
      "weight": "60~80%",
      "score": 2,
      "comment": "방향은 위지만 흔들림 있음. 한 번에 다 넣지 말고 나눠서."
    },
    { "code": "KOSDAQ", "emoji": "🇰🇷", ... },
    { "code": "SP500",  "emoji": "🇺🇸", ... },
    { "code": "NASDAQ", "emoji": "🇺🇸", ... }
  ],
  "overall": {
    "weight": "70~85%",
    "comment": "글로벌 분위기 양호. 주식 비중 70~85% 추천."
  }
}
```

시장 카드는 추가로 지수 시계열 포함:

```json
{
  "code": "KOSPI",
  "closes60": [...],
  "ma50": [...],
  "ma200": [...]
}
```

내부 지표(`mom1m`, `vol20`, `MA50` 등) 원본 값은 UI에 노출하지 않으나 디버깅/검증용으로 JSON에 `_debug` 필드로 보존:

```json
"_debug": { "trend": "up", "mom1m": 0.018, "mom3m": 0.042, "vol20": 0.19, "vix": 14.2 }
```

### 8.3 `themes.json`

```json
{
  "asOf": "2026-05-26T16:30:00+09:00",
  "kr": {
    "popular": [
      {
        "id": "semis-kr",
        "name": "반도체",
        "icon": "🧠",
        "category": "popular",
        "label": "분할매수",
        "weight": "60~80%",
        "score": 2,
        "comment": "한 달 +6.2%, 추세 양호. 분할매수 권장.",
        "closes60": [...],
        "tickers": ["005930.KS", "000660.KS", ...]
      }
      // ... 8 entries
    ],
    "value": [
      // ... 8 entries
    ]
  },
  "us": {
    "popular": [/* 8 entries */],
    "value":   [/* 8 entries */]
  }
}
```

## 9. 에러 처리

- 개별 종목 페치 실패 → 해당 종목만 스킵, 결과에 포함 안 함.
- 전체 시장 페치 실패 → 기존 `*.json` 보존, 빌드는 마지막 성공 데이터로 진행.
- JSON 부재 시 페이지 → "데이터 준비 중" 안내 컴포넌트.

## 10. 테스트

- `vitest` 단위 테스트:
  - `scoring.test.mjs`: 픽스처 종가/거래량 입력으로 알고리즘 분기 검증
  - `regime.test.mjs`: 추세/모멘텀/변동성 조합별 라벨 결과 검증
  - `fear-gauge.test.mjs`: VIX/vol20 값별 5단계 매핑 검증
  - `reason-template.test.mjs`: 점수 조합별 추천 이유 템플릿 선택 검증
  - `theme-select.test.mjs`: 마스터 풀 → 인기 8 + 투자가치 8 선정 + 중복 제거 검증
  - `theme-aggregate.test.mjs`: 구성 종목 시계열 → 첫날=100 정규화 평균 검증
  - `horizon.test.mjs`: 점수 패턴별 단/중/장 분류 검증
  - `history-update.test.mjs`: KV 엔트리 갱신/만기 전환 로직 검증
- 통합: 소규모 더미 유니버스(5개) 페치 → 스캔 → JSON 형태 검증 (Top 3 채워지는지)
- UI: 모바일 뷰포트(375×667) + 데스크탑(1280×800) 양쪽 스크린샷
- 모바일 검증: 버튼 탭 영역 ≥44px, 한 손 엄지 조작 가능

## 11. 면책 / 표기

- 푸터 고정 문구: "본 사이트의 정보는 투자 판단의 참고용이며 매수/매도 추천이 아닙니다. 모든 투자의 책임은 본인에게 있습니다."
- 데이터 출처 표기: "Source: Yahoo Finance"
- asOf 시각을 모든 결과 페이지에 노출.

## 12. 향후 (v2+)

- KRX OpenAPI 연동 (외국인/기관 순매수 → 매집 점수 강화)
- 폭(breadth) 지표 추가 (200일선 위 종목 비율)
- 워치리스트 (브라우저 localStorage)
- 일별 결과 아카이브
- 종목 상세 페이지
- Vercel Cron 자동 갱신
