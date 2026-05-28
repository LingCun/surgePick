# Bear Regime + Defensive Rotation — Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming)

## Goal

Stop letting the algorithm enter bull-style picks during bear markets. Detect bear regime per market via 50/200-day SMA death cross on the market index, and in bear US rotate into a 4-ticker defensive ETF subset; in bear KR skip new entries entirely. Remove the VIX-based entry/exit gates — death cross replaces them.

## Bear detection

```
sma50(closes, D)  = mean of last 50 closes ending at D
sma200(closes, D) = mean of last 200 closes ending at D
isBear(D, indexCloses) = sma50(D) < sma200(D)
```

Per market:
- KR uses `^KS11` (KOSPI) closes
- US uses `^GSPC` (S&P 500) closes

Index history < 200 trading days at D → `isBear === false` (no signal, default to normal).

## Defensive universe

For US bear days, the entry candidate pool narrows to (intersected with the current ETF universe):
- `SQQQ` — 3x inverse QQQ
- `GLD` — gold
- `TLT` — 20+ year Treasury
- `BND` — total bond market

Same scoring (`trendUp` + `volumeUp` + `accumulation`) applied to the defensive subset. Top-1 wins.

KR has no inverse/defensive ticker in the current universe → bear KR yields no entries.

## Entry logic

Per sim day D, per market M:

```
isBear = bearByMarket[M][D]

if M === 'KR' and isBear:
  skip new entries
elif M === 'US' and isBear:
  candidates from defensive subset only (SQQQ/GLD/TLT/BND)
else:
  candidates from full universe (existing behavior)
```

VIX_ENTRY gate removed. VIX_EXIT removed. Existing per-day matureDate exit remains.

## Schema additions

```
entry.regime: 'normal' | 'bear'   // mode at buy time
```

VIX fields (`vixAtBuy`, `vixAtSell`) stay in the schema as historical artifacts; new writes still capture today's VIX for visibility but no longer drive logic.

## Live (scan-picks)

`runTrack(opts)` fetches `^GSPC` and `^KS11` (range `1y`, sufficient for SMA200) at start. Computes `isBearUS`, `isBearKR` for today's date.

- KR bear: skip KR pick.
- US bear in ETF track: filter `usUniverse` to defensive subset before scoring.
- US bear in stock track: skip US pick (stocks have no defensive subset).

If index fetch fails (`null`), default to `isBear=false` — fail open (legacy behavior).

## Backtest (`backtest.mjs`)

Fetches `^GSPC` and `^KS11` with range=5y. Builds `bearByMarket = { KR: { date→bool }, US: { date→bool } }`. Passes through `runBacktestTrack` → `simulate({...bearByMarket, defensiveTickers})`.

## File-level changes

| File | Action |
|---|---|
| `scripts/lib/regime-detect.mjs` | new — `isBear(indexCloses, atIndex)` + `buildBearMap(indexCloses, indexDates)` |
| `scripts/lib/backtest-engine.mjs` | simulate signature gains `bearByMarket` + `defensiveTickers`; remove VIX gate; entry loop branches on bear; entries record `regime` |
| `scripts/backtest.mjs` | fetch ^GSPC + ^KS11, build bearByMarket, pass defensiveTickers + bearByMarket |
| `scripts/scan-picks.mjs` | fetch indices, per-market bear flag, ETF track narrows on bear US, stock track skips bear US/KR |
| `scripts/lib/history-store.mjs` | remove VIX_EXIT constant; updateEntry drops vix < EXIT branch; vix arg kept (for vixAtSell capture) |
| `tests/regime-detect.test.mjs` | new — SMA + bear flag tests |
| `tests/backtest-engine.test.mjs` | replace VIX gate/exit tests with bear-mode tests; existing 5 tests pass empty bearByMarket (no bear days) |
| `tests/history-store.test.mjs` | remove vix exit test; rename "keeps holding" to drop vix arg expectation |
| `src/pages/picks/[id].astro` | add regime badge (bear pick callout) |
| `src/pages/stats.astro` | reason card: 만기 + bear count? Or skip reason card update for this iteration |
| `src/data/backtest.json` + `backtest-etf.json` | regenerate |

12 files. New library + new test file.

## Tests

`tests/regime-detect.test.mjs`:
- SMA50/200 known fixtures
- Bear when slope inverts (synthetic decline)
- isBear=false when insufficient history

`tests/backtest-engine.test.mjs`:
- bearByMarket undefined or empty → existing behavior (no gating). Reuse existing 5 simulate tests with `bearByMarket: {}`.
- Bear US day with defensive subset → only defensive ticker tickers enter, even if other tickers pass scoring.
- Bear KR day → 0 KR entries that day.

`tests/history-store.test.mjs`:
- Remove the two VIX exit tests (kept earlier — `'exits with sellReason="vix"...'` + `'keeps holding when vix>=10..'`).
- Existing 4 base tests + null-vix matured test stay.

Regression target: 75 (current) − 2 (VIX exit) + 3 (new regime-detect) = 76.

## Risks

| Risk | Mitigation |
|---|---|
| Death cross lags (signal forms weeks after peak) | Acceptable. Even late entry into defensive captures bulk of bear drawdown protection. |
| 2022 TLT/BND also fell (rate hikes) — defensive ETFs not actually defensive that year | SQQQ should dominate. Aggregate across 4 still likely positive. Backtest will measure. |
| Defensive subset over-fits 2022 | Window includes 2022–2026; 2024–25 bull years still use normal universe, providing balanced evaluation. |
| KR bear yields 0 entries → KR sample shrinks | Accepted. KR universe lacks inverse ETFs; future spec could add ^VKOSPI + KR inverse if available. |
| Killing VIX gate may worsen normal-regime picks | Backtest will surface. If overall mean drops, revisit. |
| Index fetch fails → fail open | Logged warning, default behavior preserved. |

## Not in scope

- KR-side inverse/defensive (KR universe lacks suitable tickers)
- Position sizing
- Per-ticker SMA50/200 (still uses 30-day scoring window for individual stocks)
- Re-tuning thresholds (skip VIX, no new constants to tune)

---

## Plan (8 tasks, ~55 min)

### Task 1: `regime-detect.mjs` lib + tests

**Files:**
- Create: `scripts/lib/regime-detect.mjs`
- Create: `tests/regime-detect.test.mjs`

- [ ] **Step 1: Write failing test**

Create `tests/regime-detect.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { sma, isBearAt, buildBearMap } from '../scripts/lib/regime-detect.mjs';

describe('sma', () => {
  it('mean of last N values ending at index', () => {
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(sma(closes, 9, 5)).toBe(8);  // last 5 = [6,7,8,9,10] mean=8
    expect(sma(closes, 4, 5)).toBe(3);  // [1,2,3,4,5] mean=3
  });
  it('returns NaN if insufficient history', () => {
    const closes = [1, 2, 3];
    expect(Number.isNaN(sma(closes, 2, 5))).toBe(true);
  });
});

describe('isBearAt', () => {
  it('false when sma50 >= sma200', () => {
    const closes = Array.from({ length: 250 }, (_, i) => 100 + i);  // up-trend
    expect(isBearAt(closes, 249)).toBe(false);
  });
  it('true when sma50 < sma200', () => {
    const closes = Array.from({ length: 250 }, (_, i) => 200 - i * 0.5);  // down-trend
    expect(isBearAt(closes, 249)).toBe(true);
  });
  it('false when insufficient history (<200)', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(isBearAt(closes, 99)).toBe(false);
  });
});

describe('buildBearMap', () => {
  it('returns date→bool map aligned to dates array', () => {
    const dates = Array.from({ length: 250 }, (_, i) => `2024-${String(i).padStart(3, '0')}`);
    const closes = Array.from({ length: 250 }, (_, i) => 200 - i * 0.5);
    const map = buildBearMap(dates, closes);
    expect(map[dates[249]]).toBe(true);
    expect(map[dates[100]]).toBe(false);  // not enough history
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npx vitest run tests/regime-detect.test.mjs`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `scripts/lib/regime-detect.mjs`:

```javascript
/**
 * Simple moving average of the last N values ending at index `endIdx` (inclusive).
 * Returns NaN if there aren't N values available.
 */
export function sma(closes, endIdx, window) {
  if (endIdx < window - 1) return NaN;
  let sum = 0;
  for (let i = endIdx - window + 1; i <= endIdx; i++) sum += closes[i];
  return sum / window;
}

/**
 * Bear regime at endIdx: sma50 < sma200. False when insufficient history.
 */
export function isBearAt(closes, endIdx) {
  const s50 = sma(closes, endIdx, 50);
  const s200 = sma(closes, endIdx, 200);
  if (Number.isNaN(s50) || Number.isNaN(s200)) return false;
  return s50 < s200;
}

/**
 * Build { date → bool } map for every date in the dates array.
 */
export function buildBearMap(dates, closes) {
  const out = {};
  for (let i = 0; i < dates.length; i++) {
    out[dates[i]] = isBearAt(closes, i);
  }
  return out;
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run tests/regime-detect.test.mjs`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/regime-detect.mjs tests/regime-detect.test.mjs
git commit -m "feat(regime): bear detection via 50/200 SMA death cross

sma() helper, isBearAt() per-index, buildBearMap() over a dates+
closes pair. Bear = sma50 < sma200. Insufficient history (<200)
defaults to bull/normal."
```

### Task 2: backtest-engine bear gating

**Files:**
- Modify: `scripts/lib/backtest-engine.mjs`
- Modify: `tests/backtest-engine.test.mjs`

- [ ] **Step 1: Update simulate signature**

Edit `scripts/lib/backtest-engine.mjs`. Find:

```javascript
export function simulate({ tickers, simStart, simEnd, today, vixByDate = {}, vixEntry = VIX_ENTRY, vixExit = VIX_EXIT }) {
```

Replace with:

```javascript
export function simulate({ tickers, simStart, simEnd, today, vixByDate = {}, bearByMarket = {}, defensiveTickers = [] }) {
```

(Remove `vixEntry`, `vixExit` params. Add `bearByMarket`, `defensiveTickers`.)

- [ ] **Step 2: Replace VIX gate with bear gate**

Inside the per-day loop, find:

```javascript
      const vixToday = vixByDate[D] ?? null;
      if (vixToday == null || vixToday <= vixEntry) continue;
```

Replace with:

```javascript
      const vixToday = vixByDate[D] ?? null;
      const isBear = bearByMarket[market]?.[D] === true;

      // KR bear: skip (no defensive subset)
      // US bear: narrow to defensive subset (when defensive set is non-empty)
      // Else: normal universe
      let dayUniverse;
      if (isBear && market === 'KR') continue;
      if (isBear && market === 'US' && defensiveTickers.length > 0) {
        dayUniverse = marketTickers.filter((t) => defensiveTickers.includes(t.ticker));
        if (dayUniverse.length === 0) continue;
      } else if (isBear) {
        continue;  // US bear with no defensive subset (stock track)
      } else {
        dayUniverse = marketTickers;
      }
```

Then find the candidates loop:

```javascript
      const candidates = [];
      for (const t of marketTickers) {
```

Replace `marketTickers` with `dayUniverse`:

```javascript
      const candidates = [];
      for (const t of dayUniverse) {
```

- [ ] **Step 3: Remove VIX exit, add regime field**

Find `resolveExitWithVix` call:

```javascript
      const exit = resolveExitWithVix(top.ticker, top.idx, holdDays, today, vixByDate, vixExit);
```

Replace with:

```javascript
      const exit = resolveExitMatured(top.ticker, top.idx, holdDays, today, vixByDate);
```

Replace the entire `resolveExitWithVix` function with:

```javascript
function resolveExitMatured(tickerData, buyIndex, holdDays, today, vixByDate) {
  const buyDate = tickerData.dates[buyIndex];
  const matureDate = addCalendarDays(buyDate, holdDays);

  for (let k = buyIndex + 1; k < tickerData.dates.length; k++) {
    const date = tickerData.dates[k];
    if (date > today) break;
    if (date >= matureDate) {
      return {
        exitDate: date,
        exitPrice: tickerData.closes[k],
        sellReason: 'matured',
        vixAtSell: vixByDate?.[date] ?? null,
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

Find the `entries.push({...})` block. Add `regime` field. Final:

```javascript
      entries.push({
        id: `${market.toLowerCase()}-${buyDate}-${top.ticker.ticker.replace(/[.^]/g, '')}`,
        market,
        ticker: top.ticker.ticker,
        name: top.ticker.name,
        buyDate,
        buyPrice,
        exitDate: exit.exitDate,
        exitPrice: exit.exitPrice,
        return: ret,
        horizon,
        holdDays,
        score: Math.round(top.s.total * 100),
        reason: pickReason({ scores: top.s.scores, metrics: top.s.metrics }),
        status: exit.status,
        vixAtBuy: vixToday,
        sellReason: exit.sellReason,
        vixAtSell: exit.vixAtSell,
        regime: isBear ? 'bear' : 'normal',
      });
```

- [ ] **Step 4: Remove `VIX_ENTRY` and `VIX_EXIT` constants**

Delete the constants. They're no longer referenced.

- [ ] **Step 5: Update existing 5 simulate tests**

Each existing test passes `vixByDate: Object.fromEntries(t.dates.map(d => [d, 25]))` to open the VIX gate. With VIX gate gone, this is now irrelevant — pass `vixByDate: {}` (or remove from opts entirely) and tests should still work.

For each test, change the simulate call. Example:

Before:
```javascript
    const vixByDate = Object.fromEntries(t.dates.map((d) => [d, 25]));
    const entries = simulate({
      tickers: [t], simStart: '2024-01-01', simEnd: today, today, vixByDate,
    });
```

After:
```javascript
    const entries = simulate({
      tickers: [t], simStart: '2024-01-01', simEnd: today, today,
    });
```

Apply to all 5 existing tests.

- [ ] **Step 6: Delete VIX gate + override + VIX exit tests**

Delete these tests:
- `'exits early via sellReason="vix" when VIX drops below 15 mid-hold'`
- `'respects vixEntry override (allows entries below module default)'`

(They reference removed VIX behavior.)

- [ ] **Step 7: Add bear gate test**

Append inside `describe('simulate', ...)`:

```javascript
  it('skips entries on bear days (US, no defensive subset)', () => {
    const t = synthTicker({
      ticker: 'BEAR',
      name: 'Bear',
      market: 'US',
      startDate: '2024-01-03',
      n: 200,
      closeFn: (i) => {
        const c = i % 11;
        return 100 + Math.floor(i / 11) * 3 + (c < 10 ? c * 0.6 : 10 * 0.6 - 3);
      },
      volFn: (i) => Math.round(1000 * Math.pow(1.01, i)),
    });
    const bearByMarket = { US: Object.fromEntries(t.dates.map((d) => [d, true])) };
    const today = t.dates[t.dates.length - 1];
    const entries = simulate({
      tickers: [t], simStart: '2024-01-03', simEnd: today, today, bearByMarket,
    });
    expect(entries.length).toBe(0);
  });

  it('allows defensive entries on bear US days', () => {
    const t = synthTicker({
      ticker: 'SQQQ',
      name: 'SQQQ Defensive',
      market: 'US',
      startDate: '2024-01-03',
      n: 200,
      closeFn: (i) => {
        const c = i % 11;
        return 100 + Math.floor(i / 11) * 3 + (c < 10 ? c * 0.6 : 10 * 0.6 - 3);
      },
      volFn: (i) => Math.round(1000 * Math.pow(1.01, i)),
    });
    const bearByMarket = { US: Object.fromEntries(t.dates.map((d) => [d, true])) };
    const today = t.dates[t.dates.length - 1];
    const entries = simulate({
      tickers: [t], simStart: '2024-01-03', simEnd: today, today, bearByMarket,
      defensiveTickers: ['SQQQ'],
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.regime === 'bear')).toBe(true);
  });
```

- [ ] **Step 8: Full regression**

Run: `npm test`
Expected: 75 (current) − 3 (deleted VIX tests) + 2 (new bear tests) = 74. Plus 5 new from Task 1 = 79 total. Wait — Task 1 adds 5 tests. So 75 + 5 - 3 + 2 = 79.

Actual target: 79/79.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/backtest-engine.mjs tests/backtest-engine.test.mjs
git commit -m "feat(backtest): bear regime gate + defensive ETF rotation

simulate({ bearByMarket, defensiveTickers }):
- bear KR or US (no defensive set): skip new entries
- bear US with defensive subset: narrow universe to those tickers
- normal: full universe (existing behavior)

VIX gate, VIX exit, resolveExitWithVix removed.
resolveExitMatured handles matureDate-only exits.
Entries gain regime: 'normal' | 'bear' field."
```

### Task 3: backtest.mjs index fetch + bear map

**Files:**
- Modify: `scripts/backtest.mjs`

- [ ] **Step 1: Import buildBearMap**

Edit `scripts/backtest.mjs`. Find:

```javascript
import { fetchMany, fetchChart } from './fetch-yahoo.mjs';
import { simulate } from './lib/backtest-engine.mjs';
import { bucketize } from './lib/backtest-aggregate.mjs';
```

Add below:

```javascript
import { buildBearMap } from './lib/regime-detect.mjs';
```

- [ ] **Step 2: Define defensive tickers constant**

Below imports, add:

```javascript
const DEFENSIVE_TICKERS = ['SQQQ', 'GLD', 'TLT', 'BND'];
```

- [ ] **Step 3: Fetch indices in main**

Find the existing `^VIX` fetch in `main`. Replace the surrounding code:

```javascript
  console.log('[backtest] fetching ^VIX (5y)...');
  const vixData = await fetchChart('^VIX', '5y');
  if (!vixData || !vixData.dates || vixData.dates.length === 0) {
    console.error('[backtest] failed to fetch VIX — cannot run gated backtest');
    process.exit(1);
  }
  const vixByDate = {};
  for (let i = 0; i < vixData.dates.length; i++) {
    vixByDate[vixData.dates[i]] = vixData.closes[i];
  }
  console.log(`[backtest] VIX days: ${Object.keys(vixByDate).length}`);
```

with:

```javascript
  console.log('[backtest] fetching ^VIX, ^GSPC, ^KS11 (5y)...');
  const [vixData, gspcData, ksData] = await Promise.all([
    fetchChart('^VIX', '5y'),
    fetchChart('^GSPC', '5y'),
    fetchChart('^KS11', '5y'),
  ]);
  if (!gspcData || !ksData) {
    console.error('[backtest] failed to fetch indices — cannot run bear-gated backtest');
    process.exit(1);
  }
  const vixByDate = {};
  if (vixData) {
    for (let i = 0; i < vixData.dates.length; i++) {
      vixByDate[vixData.dates[i]] = vixData.closes[i];
    }
  }
  const bearByMarket = {
    US: buildBearMap(gspcData.dates, gspcData.closes),
    KR: buildBearMap(ksData.dates, ksData.closes),
  };
  const bearDaysUS = Object.values(bearByMarket.US).filter(Boolean).length;
  const bearDaysKR = Object.values(bearByMarket.KR).filter(Boolean).length;
  console.log(`[backtest] bear days — US: ${bearDaysUS}, KR: ${bearDaysKR}`);
```

- [ ] **Step 4: Pass to runBacktestTrack**

Find both `runBacktestTrack({...})` calls. Add `bearByMarket` to each. The ETF call also needs `defensiveTickers`. Update:

```javascript
  await runBacktestTrack({
    label: 'stocks',
    krUniverseFile: 'universe-kr.json',
    usUniverseFile: 'universe-us.json',
    outputPath: resolve(__dirname, '../src/data/backtest.json'),
    vixByDate,
    bearByMarket,
  });
  await runBacktestTrack({
    label: 'etfs',
    krUniverseFile: 'universe-etf-kr.json',
    usUniverseFile: 'universe-etf-us.json',
    outputPath: resolve(__dirname, '../src/data/backtest-etf.json'),
    vixByDate,
    bearByMarket,
    defensiveTickers: DEFENSIVE_TICKERS,
  });
```

- [ ] **Step 5: Plumb runBacktestTrack signature**

Find:

```javascript
async function runBacktestTrack({ label, krUniverseFile, usUniverseFile, outputPath, vixByDate }) {
```

Replace with:

```javascript
async function runBacktestTrack({ label, krUniverseFile, usUniverseFile, outputPath, vixByDate, bearByMarket, defensiveTickers = [] }) {
```

Find the `simulate` call:

```javascript
  const entries = simulate({ tickers, simStart: SIM_START, simEnd: today, today, vixByDate });
```

Replace with:

```javascript
  const entries = simulate({ tickers, simStart: SIM_START, simEnd: today, today, vixByDate, bearByMarket, defensiveTickers });
```

- [ ] **Step 6: Syntax check + commit**

```bash
node --check scripts/backtest.mjs
git add scripts/backtest.mjs
git commit -m "feat(backtest): fetch indices, build bearByMarket, pass to simulate

^GSPC and ^KS11 fetched 5y; buildBearMap derives per-day bear
flags via 50/200 SMA death cross. ETF track gets defensive
ticker set; stock track does not (no defensive in stock pool)."
```

### Task 4: scan-picks live bear gate

**Files:**
- Modify: `scripts/scan-picks.mjs`

- [ ] **Step 1: Import bear detection**

Add to top:

```javascript
import { isBearAt } from './lib/regime-detect.mjs';
```

- [ ] **Step 2: Define defensive subset at module scope**

```javascript
const DEFENSIVE_TICKERS = ['SQQQ', 'GLD', 'TLT', 'BND'];
```

- [ ] **Step 3: Add helper to compute today's bear flag per market**

Inside `runTrack`, before VIX fetch, add:

```javascript
  const [gspcData, ksData] = await Promise.all([
    fetchChart('^GSPC', '1y'),
    fetchChart('^KS11', '1y'),
  ]);
  const isBearUS = gspcData ? isBearAt(gspcData.closes, gspcData.closes.length - 1) : false;
  const isBearKR = ksData ? isBearAt(ksData.closes, ksData.closes.length - 1) : false;
  console.log(`[scan-picks/${label}] regime — US bear: ${isBearUS}, KR bear: ${isBearKR}`);
```

- [ ] **Step 4: Replace VIX gate with bear gate around scanGroup calls**

Find:

```javascript
  let krPick = null;
  let usPick = null;
  if (vix != null && vix > 20) {
    krPick = await scanGroup(kr, 'KR');
    usPick = await scanGroup(us, 'US');
  } else {
    console.log(`[scan-picks/${label}] VIX gate closed (need >20, got ${vix?.toFixed(2) ?? 'null'}) — no new entries today`);
  }
```

Replace with:

```javascript
  const isETFTrack = idPrefix === 'etf-';
  let krPick = null;
  let usPick = null;

  if (isBearKR) {
    console.log(`[scan-picks/${label}] KR bear — skipping KR entry`);
  } else {
    krPick = await scanGroup(kr, 'KR');
  }

  if (isBearUS) {
    if (isETFTrack) {
      const defensiveUs = us.filter((t) => DEFENSIVE_TICKERS.includes(t.ticker));
      console.log(`[scan-picks/${label}] US bear — defensive subset (${defensiveUs.map((t) => t.ticker).join(',')})`);
      usPick = await scanGroup(defensiveUs, 'US');
    } else {
      console.log(`[scan-picks/${label}] US bear — skipping US stock entry`);
    }
  } else {
    usPick = await scanGroup(us, 'US');
  }
```

(Note: VIX fetch + `refreshHoldings(history, today, vix)` call stays — still capture today's VIX in entries.)

- [ ] **Step 5: Syntax check + commit**

```bash
node --check scripts/scan-picks.mjs
git add scripts/scan-picks.mjs
git commit -m "feat(scan): bear regime gate (death cross) replaces VIX gate

KR bear → skip KR. US bear ETF track → defensive subset
(SQQQ/GLD/TLT/BND). US bear stock track → skip US."
```

### Task 5: history-store cleanup (drop VIX_EXIT branch)

**Files:**
- Modify: `scripts/lib/history-store.mjs`
- Modify: `tests/history-store.test.mjs`

- [ ] **Step 1: Remove VIX_EXIT constant + simplify updateEntry**

Edit `scripts/lib/history-store.mjs`. Delete:

```javascript
const VIX_EXIT = 10;
```

In `updateEntry`, remove the VIX exit branch. The function becomes:

```javascript
export function updateEntry(entry, currentPrice, today, vix = null) {
  if (entry.status === 'sold') return entry;

  const returnPct = entry.buyPrice
    ? ((currentPrice - entry.buyPrice) / entry.buyPrice) * 100
    : 0;

  if (today >= entry.matureDate) {
    return {
      ...entry,
      currentPrice,
      currentDate: today,
      returnPct,
      status: 'sold',
      sellDate: today,
      sellPrice: currentPrice,
      sellReason: 'matured',
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

(`vix` arg still accepted to capture `vixAtSell` for matured entries.)

- [ ] **Step 2: Remove the two VIX exit tests**

Edit `tests/history-store.test.mjs`. Delete:
- `'exits with sellReason="vix" when vix < 10 (before maturity)'`
- `'keeps holding when vix >= 10 and before maturity'`

Keep `'falls back to matured when vix is null and today >= matureDate'` — still valid.

- [ ] **Step 3: Run + commit**

```bash
npm test
git add scripts/lib/history-store.mjs tests/history-store.test.mjs
git commit -m "refactor(history): remove VIX exit branch

Bear gate at entry handles regime now. updateEntry simplified
to matured-only exit. vix arg retained for vixAtSell capture."
```

### Task 6: Run backtest with new regime gate

- [ ] **Step 1: Run**

Run: `npm run backtest` (timeout 900000)

Capture:
- Bear days count (US, KR)
- Both track summary
- Reason mix

- [ ] **Step 2: Inspect 2022 bucket**

Run:

```bash
node -e "const s=require('./src/data/backtest.json'); const e=require('./src/data/backtest-etf.json'); const reg = (b) => Object.entries(b.byYear).map(([y,v])=>({y,count:v.count,winRate:v.winRate?.toFixed(3),mean:v.meanReturn?.toFixed(4)})); console.log('stocks:', s.totals, reg(s)); console.log('etfs:', e.totals, reg(e));"
```

Expected: 2022 stocks bucket much smaller (mostly bear days skipped). 2022 ETF bucket may show defensive picks (SQQQ wins?).

- [ ] **Step 3: Commit**

```bash
git add src/data/backtest.json src/data/backtest-etf.json
git commit -m "data: regenerate backtest with bear regime gate"
```

### Task 7: scan:picks live with new gate

- [ ] **Step 1: Run**

Run: `npm run scan:picks`

Capture stdout regime line. Should show both US bear / KR bear today.

- [ ] **Step 2: Commit data**

```bash
git add src/data/picks.json src/data/picks-history.json src/data/picks-etf.json src/data/picks-history-etf.json
git commit -m "data: scan with bear regime gate"
```

### Task 8: Push + Vercel verify

- [ ] **Step 1: Push**

```bash
git pull --rebase && git push
```

- [ ] **Step 2: Verify /stats**

WebFetch https://surge-pick.vercel.app/stats. Confirm new totals reflect bear-gate behavior.

Capture new metrics vs prior (entry=18/exit=10) baseline:
- Stocks: count=207, mean=+1.95%
- ETFs: count=94, mean=+4.47%

Look especially at 2022 buckets.

## Self-Review

- Spec sections "Bear detection", "Defensive universe", "Entry logic" → Tasks 1, 2 (engine), 3 (backtest), 4 (live).
- Schema additions (regime field) → Task 2 entries.push.
- VIX cleanup → Task 5.
- Live + backtest data regen → Tasks 6, 7.
- TDD: Tasks 1, 2 have red-green; later tasks are wiring + data.
- Test count math: 75 → 79.
