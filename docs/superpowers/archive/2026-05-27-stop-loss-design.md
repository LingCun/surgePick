# Stop-Loss Exit Rules — Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming)

## Goal

Cap losses by exiting positions before `matureDate` when price action signals trend failure or excessive drawdown. Two parallel rules — a trailing stop from the position's high-water mark and a hard stop from the entry price — evaluated daily on closes. Applies to both the live picks history pipeline (`updateEntry`) and the historical backtest engine (`simulate`), across both stock and ETF tracks.

The motivating problem: the current pipeline only exits at `matureDate`. A long-horizon pick (365d) that loses its trend in the first month is still held for nearly a year, accruing further losses. Backtest 2022 shows this clearly: bear-market picks averaged −1.9% (stocks) and −3.5% (ETFs) because positions were held to maturity regardless of post-entry price behavior.

## Exit rules

Evaluated daily on close, in priority order:

```
maxPriceSinceEntry := max over all observed closes from buyDate to today (inclusive)
pullback           := (maxPriceSinceEntry - currentPrice) / maxPriceSinceEntry
drawdown           := (buyPrice          - currentPrice) / buyPrice

if maxPriceSinceEntry > buyPrice AND pullback >= 0.10:  sellReason = 'trailing'
else if drawdown >= 0.15:                               sellReason = 'hard'
else if today >= matureDate:                            sellReason = 'matured'
else:                                                   hold
```

Trailing is gated on `maxPriceSinceEntry > buyPrice` — it only protects picks that actually went up before giving back gains. If a pick never trades above entry, the `maxPriceSinceEntry == buyPrice` invariant makes pullback == drawdown; without the gate, trailing would always preempt hard at the 10% threshold and the hard floor at 15% would be unreachable. The gate makes hard the sole rule for never-above-entry picks (locking the floor at −15%) and trailing the rule for picks that had upside (locking gains when the high gives back 10%).

### Examples

| Entry | Trajectory | Trigger | Sell price | Return |
|---|---|---|---|---|
| 100 | rises to 130, drops to 117 | trailing (max 130 > 100 gate satisfied; 130 → 117 is 10% pullback) | 117 | +17% |
| 100 | drops to 90, never recovers above 100 | max stays at 100, trailing gate not satisfied; drawdown 10% < 15% → still holding | — | hold |
| 100 | drops to 86 (−14%) then 84 (−16%) | max=100, trailing gate not satisfied; drawdown 16% ≥ 15% → hard | 84 | −16% (capped near −15%) |
| 100 | rises to 110, then falls to 84 | max=110 > 100, pullback (110→84)=23.6% → trailing (fires before reaching hard threshold from entry) | 84 | −16% |
| 100 | bounces around 95–105 to maturity | matured | close on matureDate | varies |

## Data model

### History entry schema (`picks-history.json`, `picks-history-etf.json`)

Existing fields preserved. New fields:

```
maxPriceSinceEntry: number  // monotonically non-decreasing during status=holding
sellReason: 'matured' | 'trailing' | 'hard' | null  // null while holding
```

`sellPrice`/`sellDate` continue to be set on transition to `'sold'`; `sellReason` joins them as a sibling.

### Backtest entry (in `backtest.json`/`backtest-etf.json` `picks[]`)

Same two new fields. `simulate()` writes them once per entry at the moment of exit.

### Migration

Existing entries (active and sold) predate `maxPriceSinceEntry`. The handling:

- **Active (`status === 'holding'`):** First `updateEntry` call after deploy sees `entry.maxPriceSinceEntry == null`. Initialize as `max(entry.buyPrice, currentPrice)`. From then on, normal tracking. If the pick is already underwater (currentPrice < buyPrice), maxPriceSinceEntry = buyPrice on init; subsequent days continue to track. The hard stop at −15% can fire on the very next scan day if drawdown already exceeds that — intentional.
- **Sold (`status === 'sold'`):** Left untouched. `sellReason` remains absent; UI fallback shows the existing "✅ 매도완료" copy.

No backfill of historical data. Existing sold entries remain frozen as they are.

## Implementation surface

### `scripts/lib/history-store.mjs`

`makeEntry` initializes `maxPriceSinceEntry: pick.buyPrice` and `sellReason: null`.

`updateEntry(entry, currentPrice, today)` is rewritten to:

```javascript
export function updateEntry(entry, currentPrice, today) {
  if (entry.status === 'sold') return entry;

  const maxPriceSinceEntry = Math.max(
    entry.maxPriceSinceEntry ?? entry.buyPrice,
    currentPrice
  );
  const returnPct = entry.buyPrice
    ? ((currentPrice - entry.buyPrice) / entry.buyPrice) * 100
    : 0;
  const pullback = maxPriceSinceEntry > 0
    ? (maxPriceSinceEntry - currentPrice) / maxPriceSinceEntry
    : 0;
  const drawdown = entry.buyPrice
    ? (entry.buyPrice - currentPrice) / entry.buyPrice
    : 0;

  let sellReason = null;
  if (maxPriceSinceEntry > entry.buyPrice && pullback >= 0.10) sellReason = 'trailing';
  else if (drawdown >= 0.15) sellReason = 'hard';
  else if (today >= entry.matureDate) sellReason = 'matured';

  if (sellReason) {
    return {
      ...entry,
      maxPriceSinceEntry,
      currentPrice,
      currentDate: today,
      returnPct,
      status: 'sold',
      sellDate: today,
      sellPrice: currentPrice,
      sellReason,
    };
  }

  return {
    ...entry,
    maxPriceSinceEntry,
    currentPrice,
    currentDate: today,
    returnPct,
  };
}
```

Thresholds (`0.10`, `0.15`) are module-level constants:

```javascript
const TRAILING_PULLBACK = 0.10;
const HARD_DRAWDOWN     = 0.15;
```

### `scripts/lib/backtest-engine.mjs`

Replace `resolveExit` with `resolveExitWithStops(tickerData, buyIndex, holdDays, today)`. The new function walks dates from `buyIndex + 1` forward up to the earlier of (a) the first index whose date >= matureDate, or (b) the last index in tickerData.dates that is <= today. On each step:

- maintain `maxPrice = max(maxPrice, closes[k])`
- compute `pullback`, `drawdown`
- if either threshold trips, return `{ exitDate: dates[k], exitPrice: closes[k], sellReason: 'trailing'|'hard', maxPriceAtExit: maxPrice, status: 'matured' }`

If the loop reaches the matureDate-or-after index without tripping, return the matured exit (same as today's logic) with `sellReason: 'matured'`.

If the loop reaches `today` without hitting maturity or a stop, return `{ exitDate: null, exitPrice: null, sellReason: null, status: 'active' }`.

`simulate()` builds entries with the new fields. The aggregator (`backtest-aggregate.mjs`) does **not** need changes — `winRate`, `meanReturn`, etc. still compute from `return`, which is set correctly regardless of which exit fired.

### `src/pages/picks/[id].astro`

In the sold-status branch, switch on `entry.sellReason`:

```astro
{entry.sellReason === 'trailing' ? '⛔ 추세 청산 (최고가 -10%)'
  : entry.sellReason === 'hard'   ? '⛔ 손절 청산 (진입가 -15%)'
  : '✅ 매도완료 · 만기'}
```

Existing sold entries with no `sellReason` fall through to the matured copy (visual parity).

### `src/pages/stats.astro`

In each track panel (stocks, ETF), add a small card before the existing four StatsTables:

```
청산 사유 분포 (matured N건)
  만기  N건 (M%)
  추세  N건 (M%)
  손절  N건 (M%)
```

Counts derived from `b.picks.filter(p => p.status === 'matured').reduce(...)` on `sellReason`. Render N=0 buckets gracefully ("—").

## Tests

### `tests/history-store.test.mjs` (+6 tests)

- trailing triggered at pullback ≥ 10% → status=sold, sellReason='trailing', sellPrice=currentPrice
- hard triggered at drawdown ≥ 15% with no prior pullback → sellReason='hard'
- trailing takes precedence when both would trigger
- matured when today ≥ matureDate and no stop fired
- maxPriceSinceEntry is monotonic max across updates
- migration: entry without maxPriceSinceEntry initializes correctly on first update

### `tests/backtest-engine.test.mjs` (+2 tests)

- synthetic fixture: rise then >10% pullback → exit with sellReason='trailing'
- synthetic fixture: straight drop to −15% from entry → exit with sellReason='hard'

Fixtures must still satisfy `scorePicks` filters at entry (re-use Task 2 sawtooth + geometric-volume pattern).

### Regression target

`npm test` total: 70 (current) + 8 (new) = 78 passing.

## Operating procedure (post-implementation)

1. `npm test` — confirm 78/78.
2. `npm run scan:picks` — runs through both tracks. First call after deploy auto-migrates active entries (initializes maxPriceSinceEntry). On the same call, any entry already breaching thresholds will be marked sold with appropriate `sellReason` — that is the intended bear-protection effect.
3. Inspect the resulting `picks-history.json` / `picks-history-etf.json` diff. Spot-check a couple of newly sold entries for plausibility.
4. `npm run backtest` — regenerate `backtest.json` and `backtest-etf.json` with stop-loss applied.
5. Compare aggregate numbers vs the pre-stop-loss baseline (commits `4dba391` / earlier):
   - stocks: 50.3% winRate, +2.14% mean → target measurement, not prediction
   - ETFs:   66.3% winRate, +3.10% mean → target measurement, not prediction
   - 2022 sub-bucket: hardest case; if mean rises toward zero, the design is doing its job.
6. Commit data + push. Vercel redeploys; `/stats` shows new 청산 사유 분포 card and `/picks/[id]` shows reason labels.

## Risks

| Risk | Mitigation |
|---|---|
| Trailing −10% is too tight in choppy markets → frequent early exits with small losses | Backtest measures this. If `winRate` falls notably and `meanReturn` drops, loosen threshold (12%, 15%). |
| Hard −15% is too loose, lets too much loss accumulate before firing | Backtest measures worst-pick. Tighten (12%) if 2022 mean stays deeply negative. |
| Migration jolt: active picks already underwater get hard-stopped on the next scan | Intended. The whole point is to stop letting them bleed. Document expected migration impact: ≤4 sold entries on first post-deploy scan (current holdings = 4 stock + 1 ETF). |
| Daily close granularity misses intraday rescue / further drops | Acceptable. Yahoo daily data is the only source. Documented limitation. |
| Threshold tuning becomes a recurring tweak loop | YAGNI for this spec. Ship the 10/15 numbers, measure, iterate later if needed. |

## File-level change list

| File | Action |
|---|---|
| `scripts/lib/history-store.mjs` | modify (constants + updateEntry rewrite + makeEntry init) |
| `scripts/lib/backtest-engine.mjs` | modify (resolveExitWithStops replaces resolveExit; simulate carries new fields) |
| `tests/history-store.test.mjs` | modify (+6 tests) |
| `tests/backtest-engine.test.mjs` | modify (+2 tests) |
| `src/pages/picks/[id].astro` | modify (sellReason label switch) |
| `src/pages/stats.astro` | modify (청산 사유 분포 card in both panels) |
| `src/data/picks.json` | regenerate via scan-picks |
| `src/data/picks-history.json` | regenerate (migration + new stop-outs) |
| `src/data/picks-etf.json` | regenerate via scan-picks |
| `src/data/picks-history-etf.json` | regenerate |
| `src/data/backtest.json` | regenerate via backtest |
| `src/data/backtest-etf.json` | regenerate |

12 files (6 code, 6 data). No new files. No edits to `scoring.mjs`, `horizon.mjs`, `backtest-aggregate.mjs`, `fetch-yahoo.mjs`, `scan-picks.mjs`, `backtest.mjs`, `index.astro`, `history.astro`, `StatsTable.astro`, CI workflow.

## Not in scope

- Threshold tuning per market or per horizon (single global 10/15 to start).
- Intraday or open-price stops.
- Re-entry after a stop fires (the day's slot stays empty; ticker is back in the dedup-cleared pool but the algorithm has to re-pick it organically).
- Backfill of historical sold entries with synthetic `sellReason`.
- Aggregator (`backtest-aggregate.mjs`) changes — `winRate` and `meanReturn` already work off `return`, which the engine sets correctly.
