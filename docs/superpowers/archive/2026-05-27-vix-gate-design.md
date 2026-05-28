# VIX Regime Gate — Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming)

## Goal

Replace the failed trailing/hard stop-loss exits with a VIX-based regime filter on both entry and exit, on the premise that picks made when fear is high and exited when greed is high outperform unconditional entry + maturity-only exits.

Empirical motivation: the prior stop-loss spec (trailing 10% / hard 15%) reduced stock backtest mean from +2.14% to +0.64% — the trailing band cut winners and rarely caught real losers. The Warren-Buffett-vs-Elon-Musk roundtable converged on a regime-aware rule: "be greedy when others fear (enter when VIX > 20), be fearful when others greed (exit when VIX < 15)."

## Exit rule (replaces stop-loss)

Evaluated daily on close:

```
if VIX(today) < 15:        sellReason = 'vix'
else if today >= matureDate: sellReason = 'matured'
else:                       hold
```

No `trailing`, no `hard`. The `'vix'` exit fires for every open holding on the same day VIX prints below 15 — a portfolio-wide flush triggered by market exuberance.

## Entry gate

Per-day, before scoring/sorting candidates:

```
if VIX(D) > 20:  evaluate normally — top survivor enters
else:            skip this day for new entries
```

The dedupe set and active-holdings refresh continue regardless. Only the *new entry* path is gated.

## Threshold rationale (audit trail, not hardcoded constants commentary)

- Historical VIX baselines: 2022 bear avg ~26; 2023 normalized ~17; 2024–25 bull ~13–18; 2026 current 17.
- `VIX > 20` lets the algorithm enter on roughly the upper third of all trading days. 2022 is wide open; 2024–25 enters only on minor spikes.
- `VIX < 15` triggers on the lower third — common during late-bull complacency. Catches frothy-market exits without being absurdly rare like `< 12`.

If backtest results justify retuning, that's a follow-up spec. This one ships with 20/15.

## Data schema

### History entry (`picks-history.json`, `picks-history-etf.json`)

New optional fields:

```
vixAtBuy:  number | null   // VIX close on buyDate
vixAtSell: number | null   // VIX close on sell/exit day
```

`sellReason` extends to include `'vix'`. The historical values `'trailing'` and `'hard'` (from the prior spec) remain valid in legacy entries; the UI just doesn't produce new ones.

Removed (no longer used): nothing — `maxPriceSinceEntry` stays in the schema for legacy compatibility but is unused by the new exit logic. Future writes won't update it. Existing entries keep theirs frozen.

### Backtest entry (`backtest.json[].picks`, `backtest-etf.json[].picks`)

Same two new fields. `simulate()` writes them at the moment of entry and exit.

## Implementation surface

### `scripts/lib/history-store.mjs`

`makeEntry` gains optional `vixAtBuy` in the entry constructor:

```javascript
export function makeEntry({ market, pick, buyDate, idPrefix = '', vixAtBuy = null }) {
  return {
    // ...existing fields unchanged...
    vixAtBuy,
    vixAtSell: null,
    // ...
  };
}
```

`updateEntry` is rewritten — trailing/hard branches removed, VIX exit added:

```javascript
export function updateEntry(entry, currentPrice, today, vix = null) {
  if (entry.status === 'sold') return entry;

  const returnPct = entry.buyPrice
    ? ((currentPrice - entry.buyPrice) / entry.buyPrice) * 100
    : 0;

  let sellReason = null;
  if (vix != null && vix < 15) sellReason = 'vix';
  else if (today >= entry.matureDate) sellReason = 'matured';

  if (sellReason) {
    return {
      ...entry,
      currentPrice,
      currentDate: today,
      returnPct,
      status: 'sold',
      sellDate: today,
      sellPrice: currentPrice,
      sellReason,
      vixAtSell: vix,
    };
  }

  return {
    ...entry,
    currentPrice,
    currentDate: today,
    returnPct,
  };
}
```

Constants `TRAILING_PULLBACK`, `HARD_DRAWDOWN` are removed. A single `VIX_EXIT = 15` constant lives in the module.

### `scripts/lib/backtest-engine.mjs`

`resolveExitWithStops` deleted. Replaced with `resolveExitWithVix(tickerData, buyIndex, holdDays, today, vixByDate)`:

```javascript
const VIX_EXIT = 15;

function resolveExitWithVix(tickerData, buyIndex, holdDays, today, vixByDate) {
  const buyDate = tickerData.dates[buyIndex];
  const matureDate = addCalendarDays(buyDate, holdDays);
  for (let k = buyIndex + 1; k < tickerData.dates.length; k++) {
    const date = tickerData.dates[k];
    if (date > today) break;
    const price = tickerData.closes[k];
    const vix = vixByDate?.[date] ?? null;

    if (vix != null && vix < VIX_EXIT) {
      return {
        exitDate: date,
        exitPrice: price,
        sellReason: 'vix',
        vixAtSell: vix,
        status: 'matured',
      };
    }
    if (date >= matureDate) {
      return {
        exitDate: date,
        exitPrice: price,
        sellReason: 'matured',
        vixAtSell: vix,
        status: 'matured',
      };
    }
  }
  return {
    exitDate: null,
    exitPrice: null,
    sellReason: null,
    vixAtSell: null,
    status: 'active',
  };
}
```

`simulate()` gains `vixByDate` in its destructured opts and an entry gate at the top of the candidate-evaluation loop:

```javascript
const VIX_ENTRY = 20;

export function simulate({ tickers, simStart, simEnd, today, vixByDate = {} }) {
  // ...
  for (const D of simDates) {
    // expiry housekeeping unchanged
    // ...
    const vixToday = vixByDate[D] ?? null;
    if (vixToday == null || vixToday <= VIX_ENTRY) continue;  // gate
    // candidate loop unchanged
  }
}
```

Note: missing VIX data is treated as "not above 20" — i.e., entry skipped. Conservative.

Entries push gains `vixAtBuy: vixToday, vixAtSell: exit.vixAtSell`.

### `scripts/scan-picks.mjs`

`runTrack` fetches `^VIX` (range `1mo`) once at start. Reads last close → `vixToday`.

- Entry gate: only enter for KR/US if `vixToday > 20`.
- `refreshHoldings(history, today)` becomes `refreshHoldings(history, today, vixToday)`. Inside, the per-entry `updateEntry(entry, currentPrice, today, vixToday)` passes VIX through.

Fetch failure (`vixToday == null`): conservative — entry skipped, exit not triggered (matures stay matured per existing flow; no `'vix'` exits fired).

### `scripts/backtest.mjs`

Top of `main()`: fetch `^VIX` with `range='5y'`. Build `vixByDate = { 'YYYY-MM-DD': close }` map from the response.

`runBacktestTrack` opts gain `vixByDate`. Passes through to `simulate()`.

Track summary log includes VIX day count: `console.log('[backtest] vix days: ${Object.keys(vixByDate).length}')`.

### `src/pages/picks/[id].astro`

`sellReasonLabel` resolver extended:

```astro
const sellReasonLabel = entry.sellReason === 'trailing'
  ? '⛔ 추세 청산 · 최고가 -10%'      // legacy entries only
  : entry.sellReason === 'hard'
  ? '⛔ 손절 청산 · 진입가 -15%'      // legacy entries only
  : entry.sellReason === 'vix'
  ? '📉 VIX 청산 · 시장 탐욕 단계'
  : '✅ 매도완료 · 만기';
```

A small VIX-at-buy / VIX-at-sell line added to the detail dl when either is non-null:

```astro
{(entry.vixAtBuy != null || entry.vixAtSell != null) && (
  <div class="flex justify-between"><dt class="text-slate-400">VIX</dt>
    <dd class="font-medium">{entry.vixAtBuy?.toFixed(1) ?? '—'} → {entry.vixAtSell?.toFixed(1) ?? '—'}</dd></div>
)}
```

### `src/pages/stats.astro`

`reasonCounts` keys narrow to `{ matured, vix }`. Legacy `trailing`/`hard` entries still in `backtest.json` will count toward neither — they're from the pre-VIX-gate backtest commit which Task 6 will overwrite, so after Task 6 there are no legacy entries in the backtest JSON. Live history may carry them indefinitely; they're rare enough to ignore.

The 청산 사유 분포 card cells change from `만기 / 추세 / 손절` to `만기 / VIX`.

## File-level change list

| File | Action |
|---|---|
| `scripts/lib/history-store.mjs` | rewrite updateEntry, drop trailing/hard constants, add VIX_EXIT, makeEntry seeds vixAtBuy |
| `scripts/lib/backtest-engine.mjs` | delete resolveExitWithStops, add resolveExitWithVix, simulate gains vixByDate + VIX_ENTRY gate |
| `scripts/scan-picks.mjs` | fetch VIX in runTrack, gate entries, pass to refreshHoldings/updateEntry |
| `scripts/backtest.mjs` | fetch ^VIX 5y, build vixByDate, pass to runBacktestTrack |
| `tests/history-store.test.mjs` | replace 6 stop-loss tests with VIX exit tests |
| `tests/backtest-engine.test.mjs` | replace 2 stop-loss tests with VIX exit tests; update existing 5 simulate tests to pass vixByDate (or use synthVixMap helper) |
| `src/pages/picks/[id].astro` | extend sellReasonLabel + VIX dl row |
| `src/pages/stats.astro` | reasonCounts 만기/VIX, card cells |
| `src/data/picks.json` | regenerate via scan:picks |
| `src/data/picks-history.json` | regenerate |
| `src/data/picks-etf.json` | regenerate |
| `src/data/picks-history-etf.json` | regenerate |
| `src/data/backtest.json` | regenerate via backtest |
| `src/data/backtest-etf.json` | regenerate |

14 files (8 code, 6 data). No new files.

## Tests

### `tests/history-store.test.mjs` (replace 6 stop-loss tests with 3)

- VIX < 15 → status='sold', sellReason='vix', vixAtSell captured
- VIX >= 15 + before matureDate → still holding (no premature exit)
- VIX null/undefined → no VIX exit (safe fallback), matured flow unaffected

### `tests/backtest-engine.test.mjs`

- delete trailing-stop + hard-stop tests
- new: synthetic VIX map with one date < 15 mid-hold → exit with sellReason='vix'
- update 5 existing tests: each call to `simulate(...)` adds `vixByDate` built from synthTicker dates with constant `25` (above gate, below exit) so existing scenarios still produce entries

### Regression target

Current 78. Delete 8 stop-loss tests, add 4 VIX tests → 74 expected. `npm test` must hit 74/74.

## Risks

| Risk | Mitigation |
|---|---|
| VIX > 20 gate too restrictive in 2024–25 → very few entries | Backtest measures. If entry count drops > 80% vs prior, retune in follow-up. |
| VIX < 15 fires too often → all picks exit early | Same measurement. Retune to 12 if too aggressive. |
| ^VIX Yahoo coverage gaps on certain dates → entries skipped / no exits | Conservative defaults (gate fails closed). Document. |
| Existing live holdings carry legacy stop-loss schema (maxPriceSinceEntry) | Untouched. Migration leaves them alone; new logic ignores those fields. |
| KR market gated on US VIX — fundamental mismatch | Documented limitation. The brainstorm session accepted VIX as global fear gauge for both tracks. If KR backtest sub-bucket suffers disproportionately, follow-up could use ^VKOSPI. |

## Not in scope

- KR-specific VKOSPI (`^VKOSPI` if Yahoo supports it). Stays as a future enhancement.
- Threshold autotuning.
- Removing legacy `maxPriceSinceEntry`, `trailing`, `hard` from existing JSON entries.
- Re-running scan-regime to populate the existing regime card with extra data.
