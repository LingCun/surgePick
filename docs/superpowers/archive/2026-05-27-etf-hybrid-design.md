# ETF Hybrid Track — Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming)

## Goal

Add a parallel ETF recommendation track alongside the existing stock track. Same pick algorithm, same horizon classifier, same scoring thresholds. New universes, new data files, tab toggle in the UI. Stock behavior unchanged; ETF is purely additive.

## Scope

- New: `universe-etf-kr.json` (9 ETFs), `universe-etf-us.json` (21 ETFs).
- New data outputs: `picks-etf.json`, `picks-history-etf.json`, `backtest-etf.json`.
- Modified scanners: `scan-picks.mjs`, `backtest.mjs` — both refactored around a `runTrack(opts)` core that takes universe/output paths.
- Modified pages: `index.astro`, `history.astro`, `picks/[id].astro`, `stats.astro` — each gets a tab toggle between stock and ETF data.
- No algorithm changes: `scoring.mjs`, `horizon.mjs`, `reason-template.mjs`, `backtest-engine.mjs`, `backtest-aggregate.mjs`, `fetch-yahoo.mjs` untouched.
- No CI changes: `.github/workflows/scan.yml` unchanged. `npm run scan` produces the additional output files automatically.

## Non-goals

- Tuning the algorithm for ETF behavior. Same thresholds; same filters. If ETFs rarely pass, that is itself a finding.
- Dynamic universe ingestion (KRX feed, AUM ranking). Universes stay as committed JSON files.
- Theme carousel ETF variant. `themes.json` remains stock-only.
- Regime panel split. `regime.json` is market-level (VIX, KOSPI/KOSDAQ/SPX/NDX); shared between tracks.

## Universes

### KR ETFs — `scripts/universe-etf-kr.json`

```json
[
  { "ticker": "069500.KS", "name": "KODEX 200" },
  { "ticker": "122630.KS", "name": "KODEX 레버리지" },
  { "ticker": "102110.KS", "name": "TIGER 200" },
  { "ticker": "360750.KS", "name": "TIGER 미국S&P500" },
  { "ticker": "278530.KS", "name": "KODEX 200TR" },
  { "ticker": "133690.KS", "name": "TIGER 미국나스닥100" },
  { "ticker": "091160.KS", "name": "KODEX AI반도체TOP2플러스" },
  { "ticker": "381180.KS", "name": "TIGER 미국필라델피아반도체나스닥" },
  { "ticker": "148020.KS", "name": "RISE 200" }
]
```

9 tickers (small sample — additions expected over time).

### US ETFs — `scripts/universe-etf-us.json`

```json
[
  { "ticker": "VOO",  "name": "Vanguard S&P 500" },
  { "ticker": "SPLG", "name": "SPDR Portfolio S&P 500" },
  { "ticker": "SGOV", "name": "iShares 0-3 Month Treasury" },
  { "ticker": "IVV",  "name": "iShares Core S&P 500" },
  { "ticker": "VTI",  "name": "Vanguard Total Stock Market" },
  { "ticker": "VXUS", "name": "Vanguard Total International Stock" },
  { "ticker": "IEMG", "name": "iShares Core MSCI Emerging Markets" },
  { "ticker": "BND",  "name": "Vanguard Total Bond Market" },
  { "ticker": "IBIT", "name": "iShares Bitcoin Trust" },
  { "ticker": "VEA",  "name": "Vanguard FTSE Developed Markets" },
  { "ticker": "QQQM", "name": "Invesco NASDAQ 100" },
  { "ticker": "IEFA", "name": "iShares Core MSCI EAFE" },
  { "ticker": "BNDX", "name": "Vanguard Total International Bond" },
  { "ticker": "GOVT", "name": "iShares U.S. Treasury Bond" },
  { "ticker": "VUG",  "name": "Vanguard Growth" },
  { "ticker": "GLD",  "name": "SPDR Gold Shares" },
  { "ticker": "VT",   "name": "Vanguard Total World Stock" },
  { "ticker": "VCIT", "name": "Vanguard Intermediate-Term Corporate Bond" },
  { "ticker": "VWO",  "name": "Vanguard FTSE Emerging Markets" },
  { "ticker": "TQQQ", "name": "ProShares UltraPro QQQ (3x long)" },
  { "ticker": "SQQQ", "name": "ProShares UltraPro Short QQQ (3x short)" }
]
```

21 tickers. TQQQ/SQQQ included even though the `maxDailyReturn < 11%` filter will reject them on most volatile days; behavior is intentional and the rejection is the algorithm's own signal.

## Scan-picks refactor

Extract today's `main()` body into a parameterized function:

```javascript
async function runTrack({ krUniverse, usUniverse, historyPath, outputPath, label }) { ... }

async function main() {
  await runTrack({
    label: 'stocks',
    krUniverse: 'universe-kr.json',
    usUniverse: 'universe-us.json',
    historyPath: resolve(__dirname, '../src/data/picks-history.json'),
    outputPath:  resolve(__dirname, '../src/data/picks.json'),
  });
  await runTrack({
    label: 'etfs',
    krUniverse: 'universe-etf-kr.json',
    usUniverse: 'universe-etf-us.json',
    historyPath: resolve(__dirname, '../src/data/picks-history-etf.json'),
    outputPath:  resolve(__dirname, '../src/data/picks-etf.json'),
  });
}
```

`scanGroup`, `refreshHoldings`, `buildSnapshot`, `dailyReturn`, `vol20` remain at module scope, unchanged.

Identical algorithm path: `scorePicks` filter pass + score sort + top-1-per-market + `classifyHorizon` + `pickReason` + history-store API. Idempotent per day on the existing `hasPickToday` check.

## Backtest refactor

Same pattern. Extract a `runBacktestTrack({ krUniverse, usUniverse, outputPath })` inside `scripts/backtest.mjs`:

```javascript
async function runBacktestTrack({ krUniverseFile, usUniverseFile, outputPath, label }) { ... }

async function main() {
  await runBacktestTrack({
    label: 'stocks',
    krUniverseFile: 'universe-kr.json',
    usUniverseFile: 'universe-us.json',
    outputPath:     resolve(__dirname, '../src/data/backtest.json'),
  });
  await runBacktestTrack({
    label: 'etfs',
    krUniverseFile: 'universe-etf-kr.json',
    usUniverseFile: 'universe-etf-us.json',
    outputPath:     resolve(__dirname, '../src/data/backtest-etf.json'),
  });
}
```

Same `simulate()` + `bucketize()` calls. Same window (2022-01-01 → today). Same `simDayCountsFrom` helper.

ETF run is faster (~30 tickers × 5y vs 60). Sequential is fine; total wall-clock budget ~1 minute.

## UI changes

### Common tab pattern

A `data-*-tab` + `data-*-panel` attribute pair with a tiny inline `<script>`. Default tab: `stock`. No localStorage persistence.

```astro
<div class="mb-3 flex gap-1 rounded-full bg-slate-900 p-1 border border-slate-800">
  <button data-{topic}-tab="stock" class="flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-slate-100 bg-slate-800">종목</button>
  <button data-{topic}-tab="etf" class="flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-slate-400">ETF</button>
</div>
<div data-{topic}-panel="stock" class="...">...</div>
<div data-{topic}-panel="etf" class="hidden ...">...</div>

<script>
  const T = '{topic}';
  const tabs = document.querySelectorAll(`[data-${T}-tab]`);
  const panels = document.querySelectorAll(`[data-${T}-panel]`);
  tabs.forEach((t) => t.addEventListener('click', () => {
    const target = t.dataset[`${T}Tab`];
    tabs.forEach((x) => {
      const active = x.dataset[`${T}Tab`] === target;
      x.classList.toggle('bg-slate-800', active);
      x.classList.toggle('text-slate-100', active);
      x.classList.toggle('text-slate-400', !active);
    });
    panels.forEach((p) => p.classList.toggle('hidden', p.dataset[`${T}Panel`] !== target));
  }));
</script>
```

`{topic}` instantiated per page: `pick` on index, `history` on history, `bt` on stats.

### `index.astro`

Above existing `PickCard` block, add the tab toggle. Two panels:
- `stock` panel: existing markup, `picks.json` data.
- `etf` panel: same `PickCard` component, `picks-etf.json` data. If `picks-etf.{kr,us}` are null, render an empty-state card ("오늘 ETF 픽 없음").

### `history.astro`

Tab toggle above the list. Two history tables, each filtering its own JSON. `HistoryRow` component reused unchanged.

### `picks/[id].astro`

`getStaticPaths()` returns the union of both histories.

**ID policy:** stock entries keep the existing `${market.toLowerCase()}-${buyDate}-${tickerStripped}` format (e.g., `us-2026-05-26-ADI`). ETF entries get an explicit `etf-` prefix (e.g., `etf-us-2026-05-27-VOO`). This makes track membership readable from the ID alone and removes any chance of collision if a US stock ticker and US ETF ticker happen to share letters (e.g., a hypothetical `SPY` stock). `makeEntry` in `history-store.mjs` already accepts an opts bag; the ETF call passes a new `idPrefix: 'etf-'` option. Stock callers omit it, preserving legacy IDs untouched.

**Migration of existing stock IDs:** none. Existing entries in `picks-history.json` keep their current shape (`us-2026-05-26-ADI`). New ETF entries use the `etf-` prefix. New stock entries continue using the legacy unprefixed format. No backfill.

`getStaticPaths` deduplicates by ID and returns all entries from both files as one flat array.

### `stats.astro`

Tab toggle. Two copies of the existing summary card + four bucket tables + picks table — one bound to `backtest.json`, one to `backtest-etf.json`. `StatsTable` component reused unchanged.

## File-level change list

| File | Action |
|---|---|
| `scripts/universe-etf-kr.json` | new |
| `scripts/universe-etf-us.json` | new |
| `scripts/scan-picks.mjs` | modify (extract `runTrack`, call twice) |
| `scripts/backtest.mjs` | modify (extract `runBacktestTrack`, call twice) |
| `src/data/picks-etf.json` | new (generated, committed) |
| `src/data/picks-history-etf.json` | new (generated, committed; starts as `[]`) |
| `src/data/backtest-etf.json` | new (generated, committed) |
| `src/pages/index.astro` | modify (tab toggle + ETF data import) |
| `src/pages/history.astro` | modify (tab toggle + ETF data import) |
| `src/pages/picks/[id].astro` | modify (`getStaticPaths` union of both histories) |
| `scripts/lib/history-store.mjs` | modify (`makeEntry` accepts optional `idPrefix`) |
| `src/pages/stats.astro` | modify (tab toggle + ETF backtest import) |

12 files. The only algorithm-adjacent edit is the `idPrefix` opt on `history-store.makeEntry` — purely additive, default behavior identical to today. No edits to `scoring.mjs`, `horizon.mjs`, `reason-template.mjs`, `backtest-engine.mjs`, `backtest-aggregate.mjs`, `fetch-yahoo.mjs`, `scan.yml`, themes/regime code.

## Risks

| Risk | Mitigation |
|---|---|
| KR ETF sample of 9 is small → frequent days with 0 picks | UI shows empty-state card. Universe can be expanded by editing JSON only. |
| TQQQ/SQQQ trip the `maxDailyReturn < 11%` filter daily | Acceptable — algorithm's own behavior. Backtest will likely show ~0 entries for these. |
| `picks/[id].astro` static path explosion | Combined IDs ≈ 400 (stocks) + small ETF count. Well under any Astro limit. |
| Diff churn in `picks-history-etf.json` from daily CI cron | Same as existing `picks-history.json` — already a daily commit. |
| `runTrack` shared mutable state | None — function is pure on its inputs (local `today`, `history` array). Safe to call twice sequentially. |

## Tests

No new unit tests required. The refactor is wiring; the algorithm path is unchanged and covered by existing tests:
- `tests/scoring.test.mjs`, `tests/horizon.test.mjs`, `tests/reason-template.test.mjs`
- `tests/history-store.test.mjs` — one new assertion added: `makeEntry({ idPrefix: 'etf-', ... })` produces an id beginning with `etf-`. Default-path (no prefix) regression preserved.
- `tests/backtest-engine.test.mjs`, `tests/backtest-aggregate.test.mjs`

Regression target: `npm test` → 68/68 still pass.

Manual smoke after deploy:
- `/` — tab toggle switches between two PickCard sets.
- `/history` — tab toggle switches lists; ETF list initially empty.
- `/picks/[id]` — both stock and ETF detail pages render.
- `/stats` — tab toggle switches backtest results; ETF tab shows its own buckets.
