# Historical Backtest — Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming)
**Author:** brainstorming session

## Goal

Validate the existing pick algorithm by replaying it daily over a multi-year historical window covering bull, bear, and recovery regimes. Report win rate, mean return, and pick rate by market, horizon, and year. Surface results on a new `/stats` page.

Specifically, confirm whether the algorithm:

1. Produces profitable picks in bull markets (2024–2025).
2. Stays out of severe drawdowns (2022) or loses gracefully if it enters.
3. Behaves consistently across KR and US universes.
4. Differentiates the three horizon buckets (단기 14d / 중기 90d / 장기 365d, per `horizon.mjs`).

## Non-goals

- Re-tuning algorithm parameters (separate effort if results suggest tuning).
- Forward (live-tracked) performance measurement; that continues through the existing `picks-history.json`.
- Benchmark comparison against KOSPI / SP500 (deferred; mentioned but not selected).
- Drawdown / portfolio-level risk metrics (deferred).

## Scope

Single 1-shot script. Output one JSON file consumed by one new Astro page. No CI cron, no algorithm changes, no schema migration of existing data files.

## Window

- **Start:** 2022-01-01 (covers 2022 bear, 2023 recovery, 2024–2025 bull, 2026 recent)
- **End:** today
- **Effective sim days:** ~1,000 trading days

## Universe

- `scripts/universe-kr.json` (30 tickers)
- `scripts/universe-us.json` (30 tickers)

Total: 60 tickers. Same files the live scanner uses; no separate backtest universe.

## Architecture

### Components

```
scripts/
  backtest.mjs              # entry point — npm run backtest
  lib/
    backtest-engine.mjs     # pure: simulate(closesByTicker, dates, opts) -> entries[]
    backtest-aggregate.mjs  # entries[] -> bucketed metrics
src/
  pages/stats.astro
  components/StatsTable.astro
  data/backtest.json
```

### Data flow

```
universe-kr/us.json
        |
        v
  fetchMany(range='5y')   --- Yahoo, ~60 calls @ 200ms = ~12s
  (fetchChart extended to also return dates: string[] YYYY-MM-DD from result.timestamp)
        |
        v
  closesByTicker: { [ticker]: { dates[], closes[], volumes[], market, name } }
        |
        v
  backtest-engine.simulate(closesByTicker, simDates)
        |  for each trading day D:
        |    for each ticker:
        |      score on closes[..D]
        |      filter passes
        |    pick top KR, top US
        |    skip if active hold (dedupe)
        |    record entry
        v
  entries[]: [{ id, market, ticker, buyDate, buyPrice, exitPrice|null, return|null, horizon, holdDays, score, ... }]
        |
        v
  backtest-aggregate.bucketize(entries)
        |
        v
  backtest.json: { totals, byMarket, byHorizon, byMarketHorizon, byYear, picks[] }
        |
        v
  /stats page renders tables
```

### Re-use

The engine calls existing libs unchanged:

- `scripts/lib/scoring.mjs` — `scorePicks(data)` over a closes slice
- `scripts/lib/horizon.mjs` — `classifyHorizon({ scores, metrics, mom1m, vol20 })`
- `scripts/lib/reason-template.mjs` — `pickReason(...)` (stored on each entry for display)

`scan-picks.mjs` is not touched. The backtest engine duplicates its **selection** logic (filter passes → sort by score → top per market) but does **not** import it (scan-picks has CI/fetch concerns; the engine should stay pure).

## Simulation rules

### Sim calendar

`simDates` is built **per market** from the union of trading days across that market's tickers (filtered to >= 2022-01-01). KR picks iterate KR calendar; US picks iterate US calendar. They do not share dates — they are simulated as two independent runs and merged in aggregation.

### Entry

On each trading day D in the per-market `simDates`:

1. For each ticker T in the universe:
   - `closesSlice = closes[..D]` (slice up to and including D)
   - If `closesSlice.length < 30`: skip (insufficient history).
   - `s = scorePicks({ closes: closesSlice, volumes: volumes[..D] })`
   - If not `(s.passes.trendUp && s.passes.volumeUp && s.passes.accumulation)`: skip.
2. Sort surviving candidates per market by `s.total` descending.
3. Pick top KR and top US (one each).
4. For each pick:
   - `mom1m`, `vol20` from `closesSlice` (same helpers as `scan-picks.mjs`).
   - `{ horizon, holdDays } = classifyHorizon(...)`.
   - **Dedupe:** if T is currently in the active-hold set for that market, **skip this pick** (no replacement — leave the day's slot empty for that market).
   - Otherwise create entry, add T to active set with expiry `D + holdDays`.

### Exit

`holdDays` is **calendar days** (matches `history-store.mjs:59` which does `addDays(buyDate, holdDays)`).

For each entry:

- `matureDate = buyDate + holdDays` (calendar).
- `exitIndex` = the **earliest** index in T's date array whose date is `>= matureDate` (first trading day at or after maturity).
- If such an index exists: `exitDate = T.dates[exitIndex]`, `exitPrice = T.closes[exitIndex]`, `return = exitPrice/buyPrice - 1`, `status = "matured"`.
- Else (`matureDate > last available date in T.dates`): `exitDate = null`, `exitPrice = null`, `return = null`, `status = "active"`.

Weekend/holiday handling: if `matureDate` falls on a non-trading day, exit slides forward to the next trading day's close.

Active entries are recorded in `picks[]` but excluded from all aggregate metrics.

### Active-hold expiry

When iterating day D, before evaluating new picks: for each market's active-hold set, remove tickers whose expiry < D. This is what makes the dedupe rule a sliding window equal to each pick's own horizon.

## Output schema (`src/data/backtest.json`)

```json
{
  "asOf": "2026-05-27T08:30:00Z",
  "window": { "start": "2022-01-01", "end": "2026-05-27" },
  "simDays": 1086,
  "totals": {
    "count": 312,
    "active": 18,
    "winRate": 0.58,
    "meanReturn": 0.042,
    "medianReturn": 0.028,
    "pickRate": 0.29
  },
  "byMarket":   { "KR": { /* same shape as totals */ }, "US": { ... } },
  "byHorizon":  { "단기": { ... }, "중기": { ... }, "장기": { ... } },
  "byMarketHorizon": { "KR-단기": { ... }, "KR-중기": { ... }, ... },
  "byYear":     { "2022": { ... }, "2023": { ... }, "2024": { ... }, "2025": { ... }, "2026": { ... } },
  "picks": [
    {
      "id": "us-2024-03-14-NVDA",
      "market": "US",
      "ticker": "NVDA",
      "name": "NVIDIA",
      "buyDate": "2024-03-14",
      "buyPrice": 879.44,
      "exitDate": "2024-06-12",
      "exitPrice": 1208.88,
      "return": 0.3746,
      "horizon": "중기",
      "holdDays": 90,
      "score": 71,
      "status": "matured"
    }
  ]
}
```

Bucket numerator definitions:

- `count` — matured entries in bucket (active excluded).
- `winRate` — `(entries where return > 0).length / count`. Undefined (`null`) if `count === 0`.
- `meanReturn` — arithmetic mean of returns.
- `medianReturn` — median of returns (resistant to outliers).
- `pickRate` — `count / simDays` in scope of that bucket. For `byYear.2022`, denominator is 2022 trading days only. Helps surface "algorithm correctly avoided 2022."

## UI — `/stats`

Single Astro page. Server-rendered from `backtest.json` at build time.

Layout (mobile-first, matches existing site style):

1. **Header** — title, sim window, asOf, simDays.
2. **Totals card** — count / winRate / meanReturn / pickRate as large numbers.
3. **By Year table** — rows: 2022 / 2023 / 2024 / 2025 / 2026. Cols: count, pickRate, winRate, meanReturn. 2022 row tinted to mark the bear regime.
4. **By Horizon table** — rows: 단기 / 중기 / 장기.
5. **By Market table** — rows: KR / US.
6. **All picks table** — sortable client-side is out of scope; ship sorted by `return` descending. Mark `status="active"` rows distinctly.

One new component `StatsTable.astro` (props: title, rows, columns). Re-used for the bucket tables.

`src/pages/index.astro` gets a `/stats` link in the existing nav.

## Risks & open questions

| Risk | Mitigation |
|---|---|
| 2022 produces 0 picks (algorithm filters reject every day) | `pickRate` makes this visible and is itself a finding. UI shows "N/A" for `winRate` when `count === 0`. |
| Yahoo `range=5y` data quality for KR tickers | `fetchMany` already handles failures; missing tickers are skipped, not fatal. |
| 60 tickers × 1,000 days = 60k score calls — perf | `scorePicks` runs in <1 ms per call. ~60s total scoring. Acceptable. |
| Output JSON too large | ~300 matured + 18 active entries × ~150 bytes = ~50 KB. Fine for static page. |
| Survivorship bias (universe is 2026's universe, not 2022's) | Documented limitation. Out of scope to fix. Note on the `/stats` page. |
| Lookahead via universe choice | Same as above. Note on page. |

## Tests

`tests/backtest-engine.test.mjs`:

- Synthetic linear-up closes → every matured pick has `return > 0` → `winRate === 1`.
- Synthetic linear-down closes → no entries pass `trendUp` filter → 0 picks → confirms algorithm's bear-market avoidance is reproducible.
- Same ticker passing filter for 5 consecutive days → only 1 entry recorded (dedupe).
- Pick with `buyIndex + holdDays > lastIndex` → entry recorded with `status="active"`, `exitPrice === null`.
- Entry maturing exactly on `lastIndex` → `status="matured"`.
- `matureDate` falls on a weekend → `exitDate` slides to next trading day; `exitPrice` is that day's close (not the prior Friday).

`tests/backtest-aggregate.test.mjs`:

- Bucket assignment correctness (byMarket / byHorizon / byMarketHorizon / byYear).
- `winRate` excludes `active` entries.
- `count === 0` bucket emits `winRate: null`, `meanReturn: null`, not NaN.
- `pickRate` denominator = simDays scoped to bucket (year-level).

## File-level change list

| File | Action |
|---|---|
| `scripts/backtest.mjs` | new |
| `scripts/lib/backtest-engine.mjs` | new |
| `scripts/lib/backtest-aggregate.mjs` | new |
| `src/pages/stats.astro` | new |
| `src/components/StatsTable.astro` | new |
| `src/data/backtest.json` | new (generated, committed) |
| `tests/backtest-engine.test.mjs` | new |
| `tests/backtest-aggregate.test.mjs` | new |
| `package.json` | add `"backtest": "node scripts/backtest.mjs"` |
| `src/pages/index.astro` | add `/stats` link in nav |

10 files. No edits to existing scanners, libs, or CI.

## Not in scope

- Algorithm parameter tuning.
- Benchmark/alpha calculation.
- Per-pick drawdown.
- Backtest re-run in CI.
- Multi-pick per day (still 1 KR + 1 US).
- Replacement pick when dedupe blocks the top candidate (chose "leave slot empty" — see Simulation rules).
- Sortable / paginated stats table (ships as static sorted table).
