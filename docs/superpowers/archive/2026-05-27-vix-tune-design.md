# VIX Threshold Tuning — Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming)

## Goal

Find the (VIX_ENTRY, VIX_EXIT) combination that maximizes Sharpe-like risk-adjusted return across stocks+ETFs combined backtest, then apply it to the live constants. Current values (20/15) were chosen by intuition; this spec replaces them with data-derived values.

## Grid

```
VIX_ENTRY ∈ {16, 18, 20, 22, 24}
VIX_EXIT  ∈ {10, 12, 14, 15}
```

20 combinations. Yahoo data fetched once and reused across all combos (in-memory).

## Metric

For each combo, gather all matured picks across both tracks (stocks + ETFs). Compute:

```
count   = matured.length
mean    = mean(returns)
stddev  = sqrt(variance(returns))
sharpe  = mean / stddev          if stddev > 0, else 0
penalty = count < 30 ? 0.5 : 1.0
score   = sharpe * penalty
```

Rank by `score` descending. Tiebreak on `mean` descending.

Also surface (not for ranking, just visibility):
- `byYear.2022.mean` — bear-market behavior
- `byYear.{2023..2026}.mean` — recovery/bull behavior
- Reason mix (matured count vs vix count)

## Engine refactor

`simulate({ tickers, simStart, simEnd, today, vixByDate, vixEntry, vixExit })` — two new optional opts. Defaults stay at module-level `VIX_ENTRY = 20` and `VIX_EXIT = 15` so existing callers (`scripts/backtest.mjs`, existing tests) are unaffected.

Internally:
- The per-day gate uses the param: `vixToday <= (vixEntry ?? VIX_ENTRY)` continues.
- `resolveExitWithVix` accepts a `vixExit` param: `vix < (vixExit ?? VIX_EXIT)` triggers.

## Tune script (`scripts/tune-vix.mjs`)

Steps:

1. Fetch `^VIX` 5y → build `vixByDate`.
2. Fetch KR + US universes (regular + ETF) with `fetchMany` range=5y → 4 ticker arrays.
3. For each (entry, exit) in grid:
   - Run `simulate({...stockTickers, vixEntry, vixExit, vixByDate})`.
   - Run `simulate({...etfTickers, vixEntry, vixExit, vixByDate})`.
   - Combine matured entries from both.
   - Compute count/mean/stddev/sharpe/score + per-year means.
4. Print a sorted table.
5. Print top-3 with full byYear breakdown.

The script does **not** modify constants or commit files. It's read-only analysis.

## Apply

A subsequent task hand-edits `scripts/lib/backtest-engine.mjs` and `scripts/lib/history-store.mjs` to set new constants matching the top combo, then re-runs `npm run backtest` and pushes.

## Test

Add one new test in `tests/backtest-engine.test.mjs`:

- `simulate({ vixEntry: 18, vixExit: 12, ... })` overrides module defaults. With a vixByDate of constant 19 (between 18 and 20), entries fire under entry=18 but not under default entry=20. Verify entries.length > 0 (override works) and one comparison call with default opts produces 0 entries (sanity contrast).

Regression target: 74 → 75.

## File-level changes

| File | Action |
|---|---|
| `scripts/lib/backtest-engine.mjs` | modify — add `vixEntry`, `vixExit` opts; thread through |
| `tests/backtest-engine.test.mjs` | modify — +1 override test |
| `scripts/tune-vix.mjs` | create — grid sweep + table output |
| `scripts/lib/backtest-engine.mjs` | modify (Task 4) — constant value updated to top combo |
| `scripts/lib/history-store.mjs` | modify (Task 4) — VIX_EXIT updated to match |
| `src/data/backtest.json` | regenerate via npm run backtest |
| `src/data/backtest-etf.json` | regenerate |

3 new code edits + 1 new file + 2 data regens. No UI changes (manage card still shows 만기/VIX).

## Risks

| Risk | Mitigation |
|---|---|
| Top combo overfits historical 2022–2026 window | Document as "historical fit"; future re-tune if regime changes |
| Top combo has `count < 30` | Penalty multiplier 0.5× makes such combos rank lower; min-count filter not used (just penalty) |
| Stocks vs ETFs diverge on optimal — one combo dragged by the other | Acceptable — single shared threshold. If divergence is huge, follow-up could split per-track |
| Yahoo fetch flake | Script aborts on VIX fail; universe fetch failures filtered as usual |

## Not in scope

- Per-track separate thresholds
- Walk-forward / cross-validation
- Multi-objective Pareto (just one score)
- Threshold UI controls

---

## Plan (7 tasks, ~35 min)

### Task 1: simulate accepts vixEntry/vixExit opts (TDD)

**Files:** `scripts/lib/backtest-engine.mjs`, `tests/backtest-engine.test.mjs`

- [ ] **Step 1: Write failing override test**

Append inside `describe('simulate', ...)`:

```javascript
  it('respects vixEntry override (allows entries below module default)', () => {
    const t = synthTicker({
      ticker: 'OVR',
      name: 'Override',
      market: 'US',
      startDate: '2024-01-03',
      n: 200,
      closeFn: (i) => {
        const c = i % 11;
        return 100 + Math.floor(i / 11) * 3 + (c < 10 ? c * 0.6 : 10 * 0.6 - 3);
      },
      volFn: (i) => Math.round(1000 * Math.pow(1.01, i)),
    });
    const vixByDate = Object.fromEntries(t.dates.map((d) => [d, 19]));
    const today = t.dates[t.dates.length - 1];
    const defaultEntries = simulate({
      tickers: [t], simStart: '2024-01-03', simEnd: today, today, vixByDate,
    });
    const overrideEntries = simulate({
      tickers: [t], simStart: '2024-01-03', simEnd: today, today, vixByDate, vixEntry: 18,
    });
    expect(defaultEntries.length).toBe(0);
    expect(overrideEntries.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run — expect fail**

Run: `npx vitest run tests/backtest-engine.test.mjs -t "vixEntry override"`
Expected: FAIL (override has no effect; both calls produce 0).

- [ ] **Step 3: Thread params through `simulate` and `resolveExitWithVix`**

In `scripts/lib/backtest-engine.mjs`, update `resolveExitWithVix` signature:

```javascript
function resolveExitWithVix(tickerData, buyIndex, holdDays, today, vixByDate, vixExit = VIX_EXIT) {
```

Inside, change `if (vix != null && vix < VIX_EXIT)` to `if (vix != null && vix < vixExit)`.

Update `simulate` signature:

```javascript
export function simulate({ tickers, simStart, simEnd, today, vixByDate = {}, vixEntry = VIX_ENTRY, vixExit = VIX_EXIT }) {
```

Inside the per-day loop, change `if (vixToday == null || vixToday <= VIX_ENTRY) continue;` to `if (vixToday == null || vixToday <= vixEntry) continue;`.

In the `resolveExitWithVix` call inside simulate, pass vixExit: `const exit = resolveExitWithVix(top.ticker, top.idx, holdDays, today, vixByDate, vixExit);`

- [ ] **Step 4: Run all backtest-engine tests**

Run: `npx vitest run tests/backtest-engine.test.mjs`
Expected: 5 existing + 1 VIX + 1 override = 7 tests pass.

- [ ] **Step 5: Full regression**

Run: `npm test`
Expected: 75/75 (was 74 + 1 new).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/backtest-engine.mjs tests/backtest-engine.test.mjs
git commit -m "feat(backtest): simulate accepts vixEntry/vixExit overrides

Defaults to module constants. Enables grid sweep for threshold
tuning without touching the constants."
```

### Task 2: `scripts/tune-vix.mjs` grid sweep script

**Files:** `scripts/tune-vix.mjs`

- [ ] **Step 1: Create the script**

Create `scripts/tune-vix.mjs`:

```javascript
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMany, fetchChart } from './fetch-yahoo.mjs';
import { simulate } from './lib/backtest-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIM_START = '2022-01-01';

const ENTRY_VALUES = [16, 18, 20, 22, 24];
const EXIT_VALUES = [10, 12, 14, 15];

function todayStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function loadJson(name) {
  return JSON.parse(readFileSync(resolve(__dirname, name), 'utf8'));
}

async function loadUniverse(krFile, usFile) {
  const kr = loadJson(krFile);
  const us = loadJson(usFile);
  const krFetched = await fetchMany(kr.map((t) => ({ ...t, market: 'KR' })), { range: '5y', delayMs: 200 });
  const usFetched = await fetchMany(us.map((t) => ({ ...t, market: 'US' })), { range: '5y', delayMs: 200 });
  return [...krFetched, ...usFetched]
    .filter((row) => row.data && row.data.dates && row.data.dates.length >= 30)
    .map((row) => ({
      ticker: row.ticker, name: row.name, market: row.market,
      dates: row.data.dates, closes: row.data.closes,
      volumes: row.data.volumes, highs: row.data.highs, lows: row.data.lows,
    }));
}

function meanStddev(xs) {
  if (xs.length === 0) return { mean: 0, stddev: 0 };
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1);
  return { mean: m, stddev: Math.sqrt(v) };
}

function byYearMean(picks) {
  const buckets = {};
  for (const p of picks) {
    if (p.status !== 'matured') continue;
    const y = p.buyDate.slice(0, 4);
    (buckets[y] ??= []).push(p.return);
  }
  const out = {};
  for (const y of Object.keys(buckets).sort()) {
    const { mean } = meanStddev(buckets[y]);
    out[y] = { count: buckets[y].length, mean };
  }
  return out;
}

function evalCombo(stockTickers, etfTickers, vixByDate, today, vixEntry, vixExit) {
  const stocks = simulate({ tickers: stockTickers, simStart: SIM_START, simEnd: today, today, vixByDate, vixEntry, vixExit });
  const etfs = simulate({ tickers: etfTickers, simStart: SIM_START, simEnd: today, today, vixByDate, vixEntry, vixExit });
  const matured = [...stocks, ...etfs].filter((e) => e.status === 'matured');
  const rets = matured.map((e) => e.return);
  const { mean, stddev } = meanStddev(rets);
  const count = matured.length;
  const sharpe = stddev > 0 ? mean / stddev : 0;
  const penalty = count < 30 ? 0.5 : 1.0;
  const score = sharpe * penalty;
  const vixCount = matured.filter((e) => e.sellReason === 'vix').length;
  return { vixEntry, vixExit, count, mean, stddev, sharpe, score, vixCount, byYear: byYearMean(matured) };
}

function fmtPct(v) { return (v * 100).toFixed(2) + '%'; }
function fmt(v, d = 3) { return v.toFixed(d); }

async function main() {
  console.log('[tune-vix] fetching ^VIX 5y...');
  const vixData = await fetchChart('^VIX', '5y');
  if (!vixData) { console.error('VIX fetch failed'); process.exit(1); }
  const vixByDate = {};
  for (let i = 0; i < vixData.dates.length; i++) vixByDate[vixData.dates[i]] = vixData.closes[i];
  console.log(`[tune-vix] VIX days: ${Object.keys(vixByDate).length}`);

  console.log('[tune-vix] fetching universes...');
  const stockTickers = await loadUniverse('universe-kr.json', 'universe-us.json');
  const etfTickers = await loadUniverse('universe-etf-kr.json', 'universe-etf-us.json');
  console.log(`[tune-vix] tickers: ${stockTickers.length} stocks, ${etfTickers.length} etfs`);

  const today = todayStr();
  const results = [];
  for (const e of ENTRY_VALUES) {
    for (const x of EXIT_VALUES) {
      console.log(`[tune-vix] entry=${e} exit=${x}...`);
      results.push(evalCombo(stockTickers, etfTickers, vixByDate, today, e, x));
    }
  }
  results.sort((a, b) => (b.score - a.score) || (b.mean - a.mean));

  console.log('\n== Full ranking (sorted by score desc) ==');
  console.log('entry  exit  count  mean       stddev   sharpe   score    vixExits');
  for (const r of results) {
    console.log(
      `${String(r.vixEntry).padStart(5)}  ${String(r.vixExit).padStart(4)}  ` +
      `${String(r.count).padStart(5)}  ${fmtPct(r.mean).padStart(9)}  ${fmt(r.stddev).padStart(6)}  ` +
      `${fmt(r.sharpe).padStart(7)}  ${fmt(r.score).padStart(7)}  ${String(r.vixCount).padStart(4)}`
    );
  }

  console.log('\n== Top 3 (with byYear) ==');
  for (let i = 0; i < Math.min(3, results.length); i++) {
    const r = results[i];
    console.log(`\n#${i+1}: entry=${r.vixEntry}, exit=${r.vixExit}`);
    console.log(`  count=${r.count}, mean=${fmtPct(r.mean)}, stddev=${fmt(r.stddev)}, sharpe=${fmt(r.sharpe)}, score=${fmt(r.score)}`);
    for (const [y, b] of Object.entries(r.byYear)) {
      console.log(`  ${y}: n=${b.count} mean=${fmtPct(b.mean)}`);
    }
  }
}

main().catch((err) => { console.error('[tune-vix] failed:', err); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

Edit `package.json`. Add `"tune:vix": "node scripts/tune-vix.mjs"` to scripts.

- [ ] **Step 3: Syntax check**

Run: `node --check scripts/tune-vix.mjs`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add scripts/tune-vix.mjs package.json
git commit -m "feat(tune): VIX grid sweep script (20 combos)

Entry {16,18,20,22,24} x Exit {10,12,14,15}. Ranks by
Sharpe-like score (mean/stddev) with count<30 penalty 0.5x.
Read-only — does not modify constants."
```

### Task 3: Run grid sweep + capture top combo

**Files:** stdout

- [ ] **Step 1: Run**

Run: `npm run tune:vix` (timeout 900000)

- [ ] **Step 2: Capture top combo**

Identify the (entry, exit) pair at row #1 of the ranking. Verify count ≥ 30 (no penalty applied). If top combo has count < 30, walk down to the first count≥30 row instead — that's the actual recommendation.

Report:
- Top combo's (entry, exit, count, mean, sharpe, score, byYear)
- Top 3 ranking
- Decision: which combo to apply

### Task 4: Apply top combo to constants

**Files:** `scripts/lib/backtest-engine.mjs`, `scripts/lib/history-store.mjs`

- [ ] **Step 1: Update backtest-engine constants**

Edit `scripts/lib/backtest-engine.mjs`. Change `const VIX_ENTRY = 20;` and `const VIX_EXIT = 15;` to the top-combo values.

- [ ] **Step 2: Update history-store**

Edit `scripts/lib/history-store.mjs`. Change `const VIX_EXIT = 15;` to match.

- [ ] **Step 3: Run regression**

Run: `npm test`
Expected: 75/75. Tests should pass — the override test uses explicit `vixEntry: 18`, so it doesn't depend on default value. Other simulate tests use open-gate `vixByDate=25` which is comfortably above any plausible new default.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/backtest-engine.mjs scripts/lib/history-store.mjs
git commit -m "tune(vix): adopt top combo from grid sweep (entry=X, exit=Y)

Selected by Sharpe-like score (mean/stddev) over stocks+ETFs
combined matured picks 2022→today. See docs/superpowers/specs/
2026-05-27-vix-tune-design.md for grid scope and metric."
```

(Replace X/Y in the commit message with actual values.)

### Task 5: Regenerate backtest data

**Files:** `src/data/backtest.json`, `src/data/backtest-etf.json`

- [ ] **Step 1: Run backtest**

Run: `npm run backtest` (timeout 900000)

- [ ] **Step 2: Quick sanity**

Run:

```bash
node -e "const s=require('./src/data/backtest.json'); const e=require('./src/data/backtest-etf.json'); console.log({stocks:s.totals, etfs:e.totals})"
```

Numbers should be in line with the tune script's projection for the top combo (small differences from sample-day boundaries are OK).

- [ ] **Step 3: Commit**

```bash
git add src/data/backtest.json src/data/backtest-etf.json
git commit -m "data: regenerate backtest with tuned VIX thresholds"
```

### Task 6: Push + Vercel verify

- [ ] **Step 1: Pull/push**

Run: `git pull --rebase && git push`

- [ ] **Step 2: Verify /stats**

WebFetch https://surge-pick.vercel.app/stats and confirm new totals/reason counts.

- [ ] **Step 3: Report**

Final comparison vs prior VIX (20/15) result.

## Self-Review

- All grid coords listed.
- Metric definition has formula.
- Override test specified in code.
- Apply step uses concrete values once known.
- Helpers `meanStddev`, `byYearMean` defined in tune script.
- No placeholder text; commit messages get actual top-combo values at Task 4 time.

Spec written; committing.
