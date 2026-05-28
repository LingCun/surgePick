# surgePick

모바일 우선 한국·미국 주식 **포트폴리오 시뮬레이터** (CWC v2 / WBCSR 전략).

- KR ₩10,000,000 + US $10,000 초기자본으로 mean-reversion + DCA 전략 시뮬레이션
- **CHEAP** (RSI<35 + MA200 근접) 시그널에 3분할 DCA 매수, **RICH** (RSI>70 또는 MA200 +20%↑) + 수익≥20%에 3분할 분할 매도
- 5단 위험 게이트: 손절 (-10%) / 후행 (-15%) / 후행 강 (+20% 이후 -4%) / 약세장 청산 / 보유기간 만료
- 마켓당 최대 5개 동시 보유, 2022-01-01부터 백테스트

## 페이지

| 경로 | 내용 |
|---|---|
| `/` | 포트폴리오 요약 + 오늘의 매매 행동 + 시장 온도계 (VIX·4시장·overall) |
| `/portfolio` | 누적 자산 곡선, 현재 보유, 거래 원장, 청산 사유 분포 |
| `/watchlist` | 일일 CHEAP / NEUTRAL / RICH 스냅샷 |
| `/stats` | CAGR / MDD / Sharpe 백테스트 헤드라인 |

## 로컬 실행

```bash
npm install
npm run dev          # http://localhost:4321
```

## Scripts

- `npm run backtest` — 4.5년 포트폴리오 시뮬레이션 → `src/data/backtest.json` (5-7분)
- `npm run scan:picks` — state-advancing 라이브 스캐너 → `portfolio.json` + `watchlist.json` + `picks.json` (8-15분)
- `npm run scan:regime` — VIX + 4시장 → `regime.json` (~30초)
- `npm run scan:themes` — KR/US 테마 데이터 → `themes.json` (현재 페이지에서 미사용이지만 워크플로 유지)
- `npm run scan` — regime → themes → picks 순차 실행
- `npm test` — Vitest 단위 테스트
- `npm run build` — Astro 정적 빌드

## 배포

Vercel 정적 호스팅. `main` 브랜치 push 시 자동 재빌드 → 배포.

## 자동 데이터 갱신 (GitHub Actions)

`.github/workflows/scan.yml` cron:
- KST 16:30 (KOSPI 마감 후)
- ET 16:30 (NYSE 마감 후, EDT/EST 둘 다 커버)
- 수동 트리거: GitHub Actions 탭 → Daily data scan → Run workflow

흐름: `npm ci` → `npm run scan` → `src/data/*.json` 변경 있으면 자동 커밋 + push → Vercel 재배포.

## 핵심 파일

| 경로 | 역할 |
|---|---|
| `scripts/lib/valuation.mjs` | RSI(14), MA200, CHEAP/RICH 태깅 |
| `scripts/lib/dca-plan.mjs` | 3-분할 DCA + 분할 매도 스케줄러 |
| `scripts/lib/exit-rules.mjs` | 5단 위험 게이트 (튜닝 지점) |
| `scripts/lib/portfolio.mjs` | state init/buy/sell/equity 순수 함수 |
| `scripts/lib/backtest-engine.mjs` | 포트폴리오 시뮬레이션 드라이버 (일별 루프) |
| `scripts/lib/backtest-aggregate.mjs` | CAGR/MDD/Sharpe + 청산 사유 분포 |
| `scripts/backtest.mjs` | 백테스트 러너 |
| `scripts/scan-picks.mjs` | state-advancing 라이브 스캐너 |
| `docs/superpowers/specs/2026-05-28-cwc-portfolio-design.md` | 전략 스펙 |
| `HANDOFF.md` | 현재 백테스트 결과, 다음 이터레이션 후보 |

## 면책

본 사이트의 정보는 투자 판단의 참고용이며 매수/매도 추천이 아닙니다. 모든 투자의 책임은 본인에게 있습니다.

데이터 출처: Yahoo Finance.
