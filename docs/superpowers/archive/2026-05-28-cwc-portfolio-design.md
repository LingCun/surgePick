# CWC v2 — Portfolio Simulator with Watch-Buy-Cheap-Sell-Rich (WBCSR)

**Date:** 2026-05-28
**Status:** Approved (brainstorming)

## Goal

Move surgePick from per-pick metric optimization to portfolio-level capital allocation. Pick eligible tickers via mean-reversion (buy on pullback, sell on extension), accumulate via DCA, distribute via ladder selling, gate risk via 5-tier exit. Target ≥15% CAGR over 4.5-year backtest with max drawdown < 15%.

Strategy name: **CWC (Conviction-Weighted Compounding)** with **WBCSR (Watch-Buy-Cheap-Sell-Rich)** entry/exit overlay.

## Philosophy

Existing v1 = momentum breakout (buy when 3-condition pass). User direction = value/mean-reversion: "watch upside candidates, buy when cheap periodically, sell when expensive periodically." This spec replaces the binary one-shot entry/matured-exit model with a stateful portfolio that DCAs into pullbacks and distributes into rallies.

## Initial capital

- KR pool: 10,000,000 KRW
- US pool: 10,000 USD
- ETF track and stock track share the same pool per market (positions counted together against the 5-slot cap).

## Universe → Watchlist filter

For each ticker in `universe-kr.json` / `universe-us.json` / `universe-etf-kr.json` / `universe-etf-us.json`, daily:

**Quality gate (in watchlist if ALL):**
- 200-day SMA exists (≥200 trading days history)
- Price > MA200 OR 60-day RS (ticker 60d return − index 60d return) > 0
- Not in bear-regime market (if bear, watchlist empty for that market)

**Valuation tag:**
- `CHEAP`: RSI(14) < 35 AND |price − MA200| / MA200 < 0.10 (within 10% of MA200, oversold)
- `RICH`: RSI(14) > 70 OR price > MA200 × 1.20
- `NEUTRAL`: otherwise

Watchlist persists daily snapshot in `src/data/watchlist.json`.

## Conviction multiplier (legacy momentum reused)

When a CHEAP signal triggers buy, run the existing `scorePicks` 3-condition check on the same data window:
- If 3-condition pass (trendUp + volumeUp + accumulation): conviction = 1.5
- Else: conviction = 1.0
- Additional cheap-deepness factor: if `(MA200 − price) / MA200 > 0.05`: conviction × 1.3 (deeper pullback, bigger size)

Conviction clamps to `[0.7, 1.5]` × base size.

## Position sizing

Base size = `equity / 5` (each pool, 5 slots max per market).
Target size = `base × conviction × volAdjust`.
volAdjust: if `vol20 > 0.35`, multiply by 0.7. Else 1.0.

Shares = `floor(target_size / current_price)`.

Min position guard: skip buy if `target_size < equity × 0.05` (would create dust position).

## DCA buy plan

When CHEAP signal triggers AND ticker not held AND slot free AND not in blacklist:

1. Day 1: buy `floor(targetShares × 1/3)` at close
2. Day 6 (5 trading days later): if still CHEAP and ticker still held: buy next 1/3 at close
3. Day 11 (10 trading days later): if still CHEAP: buy last 1/3

Drop remaining chunks if:
- Ticker becomes NEUTRAL or RICH between chunks
- Risk gate fires (catastrophe / trailing / bear)
- Slot pressure (other pending DCAs filling) — first-come-first-served

Track DCA state per position: `{ remainingChunks, lastBuyDate, plannedBuyDates: [d6, d11] }`.

## Distribution sell plan

When position becomes RICH AND `unrealizedGain >= 10%`:

1. Day 1: sell 33% of shares at close
2. Day 6: if still RICH: sell next 33%
3. Day 11: if still RICH: sell remaining 34%

Drop remaining chunks if ticker becomes NEUTRAL or CHEAP (let it ride).

Distribution state per position: `{ remainingFraction, plannedSellDates }`.

## Risk gates (override DCA/distribution)

Checked daily, on every position. First match fires.

| # | Condition | Action | sellReason |
|---|---|---|---|
| 1 | `close < avgCost × 0.90` | sell 100% | `catastrophe` |
| 2 | `close < peak × 0.92` (default trailing) | sell 100% | `trailing` |
| 3 | `gain ≥ 0.20` AND `close < peak × 0.96` | sell 100% | `trailing-tight` |
| 4 | `bearByMarket[D] === true` | sell 100% (all positions in that market) | `bear-flip` |
| 5 | `holdingDays > 365` | sell 100% | `time-stop` |

Risk gate takes priority over DCA/distribution. If gate fires mid-DCA, abort plan + blacklist 30 days.

## Blacklist

When position exits via gate 1 (catastrophe) or gate 2 (trailing default) at a loss: ticker blacklisted for 30 calendar days. Cannot re-buy in that window.

## State machine

```
state = {
  kr: { cash: number, positions: Position[], pending: DcaPlan[], blacklist: Map<ticker, expiryDate> },
  us: { cash, positions, pending, blacklist },
  equityCurve: [{ date, totalEquityKrwEquiv, kr: { cash, posValue }, us: { cash, posValue } }]
}

Position = {
  ticker, market, name,
  shares,         // total accumulated
  costBasis,     // total $ spent (sum of buys)
  avgCost,       // costBasis / shares
  peak,          // max close since first buy
  firstBuyDate, lastBuyDate,
  dcaPlan: { remainingChunks: 0|1|2, plannedDates: string[] } | null,
  distPlan: { remainingFraction: number, plannedDates: string[] } | null,
}
```

`totalEquityKrwEquiv` uses fixed FX rate `USD_KRW = 1300` (simplification; revisit in v3).

## Backtest engine rewrite

`simulate({ tickers, simStart, simEnd, today, indexByMarket, bearByMarket, initialCapital })`:

For each `D` in `simDates`:
1. **Update peaks**: for each open position, `peak = max(peak, close[D])`
2. **Risk gates pass**: check every position against 5 risk gates. Fire first match. Update cash, free slots, blacklist if applicable.
3. **DCA fills**: for each pending DCA plan due today, attempt fill (if signal still CHEAP and cash sufficient).
4. **Distribution fills**: for each active dist plan due today, attempt fill (if signal still RICH).
5. **New entries**: scan watchlist for CHEAP signals → for each, if (slot free + not blacklisted + sufficient cash): create position + DCA plan, execute day-1 buy.
6. **Record equity curve point** for D.

Output:
- `entries[]` — ledger of every buy/sell with `{ date, action: 'buy'|'sell', ticker, shares, price, reason, sourcePlan }`
- `positions[]` — final state + history per ticker
- `equityCurve[]` — daily total equity
- `metrics: { cagr, maxDD, sharpe, avgHold, turnover, dcaFillRate, sellGateBreakdown }`

## Files

| File | Action |
|---|---|
| `scripts/lib/valuation.mjs` | new — RSI(14), MA200, distance, CHEAP/RICH tagging |
| `scripts/lib/portfolio.mjs` | new — state init/update, equity computation, FX conversion |
| `scripts/lib/dca-plan.mjs` | new — DCA + distribution scheduling helpers |
| `scripts/lib/exit-rules.mjs` | new — 5-tier risk gate evaluator |
| `scripts/lib/backtest-engine.mjs` | full rewrite — portfolio sim driver |
| `scripts/lib/backtest-aggregate.mjs` | extend — CAGR / MDD / Sharpe / turnover |
| `scripts/backtest.mjs` | pass initialCapital + indexByMarket; emit portfolio.json |
| `scripts/scan-picks.mjs` | emit watchlist daily; live state advance using stored portfolio.json |
| `src/data/watchlist.json` | new generated — today's cheap/rich tags |
| `src/data/portfolio.json` | new generated — equity curve + positions + ledger |
| `src/data/backtest.json` | repurposed — equity curve + metrics (drops per-pick aggregate) |
| `src/pages/watchlist.astro` | new — today CHEAP / RICH / NEUTRAL grouping |
| `src/pages/portfolio.astro` | new — equity curve chart + current positions |
| `src/components/EquityCurve.astro` | new — SVG line chart |
| `src/components/PositionRow.astro` | new — ticker, avgCost, shares, currentValue, gain, dcaStatus |
| `src/pages/index.astro` | add "Watchlist" + "Portfolio" nav links |
| `tests/valuation.test.mjs` | new — RSI / MA / tag tests |
| `tests/dca-plan.test.mjs` | new — fill scheduling tests |
| `tests/exit-rules.test.mjs` | new — 5-tier gate tests |
| `tests/portfolio.test.mjs` | new — state mutation, FX, equity computation |
| `tests/backtest-engine.test.mjs` | full rewrite — portfolio-based integration tests |

## Live (scan-picks)

`scripts/scan-picks.mjs` evolves into a **state-advancing scanner**:

1. Load `src/data/portfolio.json` (or seed initial capital if missing — first run only)
2. Fetch today's OHLCV for all universe tickers + indices
3. Run simulate from `lastUpdateDate` to today on the persisted state
4. Write back portfolio.json + watchlist.json + picks.json (today's actions)

Idempotent: if run twice in a day, second run is no-op (state already at today).

## UI changes

### `/watchlist` (new)

Three columns: CHEAP / NEUTRAL / RICH. Each cell: ticker, name, price, RSI, MA200 distance, in-portfolio indicator.

### `/portfolio` (new)

- Equity curve chart (full backtest history + live simulation)
- Headline metrics: total equity, total return, CAGR, MDD, Sharpe
- Open positions table: ticker, shares, avgCost, current, unrealized %, peak, DCA/Dist status
- Closed positions ledger (top 20 most recent)

### `/stats` (updated)

- Replace per-pick bucket tables with: CAGR / MDD / Sharpe / sellGateBreakdown by year
- Add small ledger table (top 10 trades by P&L)

### `/` (updated)

- Index page replaces "today's picks" with "today's actions": newly opened DCA / distribution fills / risk gate exits
- "지금 시장 어때?" stays (regime card unchanged)

## Tests

### `valuation.test.mjs`
- RSI(14) matches known fixture (e.g., textbook RSI series)
- MA200 computes correctly on synthetic data
- CHEAP tag fires when RSI<35 + price within 10% of MA200
- RICH tag fires when RSI>70
- RICH overrides on price > MA200 × 1.20 even with RSI in 50-70 range

### `dca-plan.test.mjs`
- Creates 3-chunk plan with day 1, 6, 11 schedule
- Aborts plan when signal flips to NEUTRAL between chunks
- Returns due-today chunks correctly

### `exit-rules.test.mjs`
- Gate 1 catastrophe fires at exactly close = avgCost × 0.90
- Gate 2 trailing fires at peak × 0.92
- Gate 3 tight trailing only after gain ≥ 0.20
- Gate priority: catastrophe wins over trailing in conflict cases
- Bear gate flips all positions in market

### `portfolio.test.mjs`
- Equity computed correctly with KR cash + KR positions + US cash × FX + US positions × FX
- Buy mutates cash + shares + costBasis
- Partial sell mutates fractions correctly, doesn't reset peak

### `backtest-engine.test.mjs`
- Full year synthetic uptrend → multiple DCA fills + distribution sells, ends with positive equity
- Catastrophe synthetic → single buy → -10% drop → gate 1 fires → blacklist 30d → no re-buy
- Bear regime mid-sim → all positions liquidate
- Equity curve length matches simDates length

## Risks

| Risk | Mitigation |
|---|---|
| RSI/MA200 strategies under-perform in strong trend years (e.g., 2024 US) — never CHEAP | Conviction multiplier rewards 3-condition pass, partially captures breakout strength |
| 5-slot cap leaves cash drag if few CHEAP signals | Idle cash earns 0% (conservative); acceptable for v1 |
| FX fixed at 1300 ignores real volatility | KR and US tracked separately; only top-line equity uses FX |
| Risk gates trigger too often → high turnover hurts | Backtest will measure. If turnover > 8/year, loosen trailing to -10% / -6% |
| Blacklist may exclude good re-entries | 30-day window is short enough; tickers cycle through |
| 365-day time stop arbitrary | Picks rarely hold > 90d under existing logic; this is safety net |
| Bear-flip liquidation may sell at local bottom | Acceptable — bear gate proved valuable in prior spec for protecting drawdowns |
| Existing 3-condition logic deprecated | Kept as conviction signal — not lost |

## Migration

Existing `src/data/backtest.json` + `backtest-etf.json` + `picks.json` + history files repurposed. Add backwards-compat reader: if loaded portfolio.json missing on first run, initialize from initialCapital. Existing per-pick tests deleted (replaced by portfolio tests).

## Not in scope (v2)

- Variable FX (KRW/USD daily rate)
- Sector concentration limits (max 2 of same sector)
- Multi-leg options
- Margin / leverage
- Live broker integration
- Tax / commission modeling
- Slippage modeling
- Walk-forward optimization

## Self-review checklist

- [x] No placeholders / TBDs
- [x] No internal contradictions (verified: risk gate priority explicit; DCA/distribution clearly subordinate)
- [x] Scope: single iteration but large — could split into "v2a portfolio infra" + "v2b WBCSR triggers" if needed. Decision: ship together since they're tightly coupled (portfolio state without WBCSR is unused; WBCSR without portfolio is the existing model).
- [x] Ambiguity: "still CHEAP" at DCA chunk fill means signal must be re-evaluated on that day's data, not the day plan was created — explicit in DCA plan section.
