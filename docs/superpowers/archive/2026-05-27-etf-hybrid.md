# ETF Hybrid Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parallel ETF recommendation track (universe → scan → history → backtest → UI tabs) that runs alongside the existing stock track without changing the algorithm or CI.

**Architecture:** Refactor both `scan-picks.mjs` and `backtest.mjs` into a `runTrack({ krUniverse, usUniverse, historyPath, outputPath })` pattern, called once for stocks (legacy paths) and once for ETFs (new paths). Add `idPrefix` opt to `history-store.makeEntry` to namespace ETF entry IDs. UI: a shared `src/scripts/track-tabs.ts` switches stock/ETF panels on `/`, `/history`, and `/stats` via `data-track-tab` / `data-track-panel` attributes.

**Tech Stack:** Node 20 ESM, Vitest, Astro 4.x, Tailwind, Yahoo Finance chart endpoint.

**Spec:** `docs/superpowers/specs/2026-05-27-etf-hybrid-design.md`

---

## File-level change list

| File | Action | Purpose |
|---|---|---|
| `scripts/universe-etf-kr.json` | create | 9 KR ETFs |
| `scripts/universe-etf-us.json` | create | 21 US ETFs |
| `scripts/lib/history-store.mjs` | modify | `makeEntry({ idPrefix })` additive opt |
| `tests/history-store.test.mjs` | modify | One added test for `idPrefix` |
| `scripts/scan-picks.mjs` | modify | Extract `runTrack(opts)`, call twice (stocks + ETFs) |
| `scripts/backtest.mjs` | modify | Extract `runBacktestTrack(opts)`, call twice |
| `src/data/picks-etf.json` | create (generated) | Today's ETF picks snapshot |
| `src/data/picks-history-etf.json` | create (generated, starts `[]`) | ETF history accumulator |
| `src/data/backtest-etf.json` | create (generated) | ETF backtest output |
| `src/scripts/track-tabs.ts` | create | Shared stock/ETF tab toggle client script |
| `src/pages/index.astro` | modify | Tab toggle inside `section-picks` + ETF data import |
| `src/pages/history.astro` | modify | Tab toggle + ETF data import |
| `src/pages/picks/[id].astro` | modify | Union of stock + ETF histories in `getStaticPaths` |
| `src/pages/stats.astro` | modify | Tab toggle + ETF backtest import |

14 files. The only algorithm-adjacent edit is the additive `idPrefix` option on `history-store.makeEntry`.

---

## Task 1: ETF universe files

**Files:**
- Create: `scripts/universe-etf-kr.json`
- Create: `scripts/universe-etf-us.json`

- [ ] **Step 1: Write KR universe**

Create `scripts/universe-etf-kr.json`:

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

- [ ] **Step 2: Write US universe**

Create `scripts/universe-etf-us.json`:

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

- [ ] **Step 3: Verify JSON validity**

Run: `node -e "console.log('kr:', JSON.parse(require('fs').readFileSync('scripts/universe-etf-kr.json','utf8')).length, 'us:', JSON.parse(require('fs').readFileSync('scripts/universe-etf-us.json','utf8')).length)"`
Expected output: `kr: 9 us: 21`

- [ ] **Step 4: Commit**

```bash
git add scripts/universe-etf-kr.json scripts/universe-etf-us.json
git commit -m "data: ETF universes (KR 9, US 21)"
```

---

## Task 2: Extend `history-store.makeEntry` with `idPrefix`

**Files:**
- Modify: `scripts/lib/history-store.mjs:49-72`
- Modify: `tests/history-store.test.mjs`

`makeEntry` currently builds `id = ${market.toLowerCase()}-${buyDate}-${tickerStripped}`. Add an optional `idPrefix` that prepends to the id. Default behavior unchanged.

- [ ] **Step 1: Read existing test file**

Run: `head -40 tests/history-store.test.mjs`
Note the existing test names and patterns so the new assertion matches house style.

- [ ] **Step 2: Add the failing test**

Open `tests/history-store.test.mjs`. After the existing `describe('makeEntry', ...)` block (or inside it, before the closing brace), add:

```javascript
  it('prepends idPrefix when provided', () => {
    const entry = makeEntry({
      market: 'US',
      buyDate: '2026-05-27',
      pick: {
        ticker: 'VOO',
        name: 'Vanguard S&P 500',
        buyPrice: 500,
        horizon: '중기',
        holdDays: 90,
        reason: 'r',
        score: 50,
        metrics: {},
        scores: {},
        closes30: [],
      },
      idPrefix: 'etf-',
    });
    expect(entry.id).toBe('etf-us-2026-05-27-VOO');
  });

  it('omits prefix by default (legacy id format)', () => {
    const entry = makeEntry({
      market: 'KR',
      buyDate: '2026-05-27',
      pick: {
        ticker: '005930.KS',
        name: '삼성전자',
        buyPrice: 70000,
        horizon: '단기',
        holdDays: 14,
        reason: 'r',
        score: 50,
        metrics: {},
        scores: {},
        closes30: [],
      },
    });
    expect(entry.id).toBe('kr-2026-05-27-005930KS');
  });
```

- [ ] **Step 3: Run test to verify failure**

Run: `npx vitest run tests/history-store.test.mjs`
Expected: at least one of the two new tests fails. The `etf-` prefix test fails because `makeEntry` doesn't accept that option yet.

- [ ] **Step 4: Modify `makeEntry`**

Edit `scripts/lib/history-store.mjs`. Find:

```javascript
export function makeEntry({ market, pick, buyDate }) {
  return {
    id: `${market.toLowerCase()}-${buyDate}-${pick.ticker.replace(/[.^]/g, '')}`,
```

Replace with:

```javascript
export function makeEntry({ market, pick, buyDate, idPrefix = '' }) {
  return {
    id: `${idPrefix}${market.toLowerCase()}-${buyDate}-${pick.ticker.replace(/[.^]/g, '')}`,
```

Nothing else in the function changes.

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run tests/history-store.test.mjs`
Expected: all tests in this file pass, including the two new ones.

- [ ] **Step 6: Full regression**

Run: `npm test`
Expected: all 68+ tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/history-store.mjs tests/history-store.test.mjs
git commit -m "feat(history): makeEntry accepts optional idPrefix

Additive opt; default behavior unchanged. ETF track will pass
idPrefix: 'etf-' so ETF entry IDs are namespaced and never
collide with stock IDs even if tickers overlap."
```

---

## Task 3: Refactor `scan-picks.mjs` to `runTrack` + add ETF call

**Files:**
- Modify: `scripts/scan-picks.mjs`

Extract the existing `main()` body into a parameterized `runTrack(opts)`. Then call it twice: once for stocks (legacy paths), once for ETFs (new paths). The function `scanGroup`, `refreshHoldings`, `dailyReturn`, `vol20`, helpers stay at module scope unchanged.

- [ ] **Step 1: Open and inspect current structure**

Run: `head -60 scripts/scan-picks.mjs`
Confirm `main()` is the bottom function and the constants `OUTPUT`, `HISTORY` are at the top.

- [ ] **Step 2: Replace constants + `main` with `runTrack` + new `main`**

Edit `scripts/scan-picks.mjs`. Find the top-level constants:

```javascript
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '../src/data/picks.json');
const HISTORY = resolve(__dirname, '../src/data/picks-history.json');
```

Replace with just:

```javascript
const __dirname = dirname(fileURLToPath(import.meta.url));
```

(Remove `OUTPUT` and `HISTORY` — they become parameters of `runTrack`.)

- [ ] **Step 3: Rename `main` body to `runTrack`**

Find the `async function main()` declaration. Rename to:

```javascript
async function runTrack({ label, krUniverseFile, usUniverseFile, outputPath, historyPath, idPrefix = '' }) {
```

Inside the body, replace `OUTPUT` → `outputPath` and `HISTORY` → `historyPath` everywhere they appear.

Replace `load('universe-kr.json')` → `load(krUniverseFile)`.
Replace `load('universe-us.json')` → `load(usUniverseFile)`.

In the two `makeEntry({ market: 'KR', ...})` and `makeEntry({ market: 'US', ...})` calls, add `idPrefix` to each:

```javascript
if (krPick && !hasPickToday(history, 'KR', today)) {
  newEntries.push(makeEntry({ market: 'KR', buyDate: today, pick: krPick, idPrefix }));
}
if (usPick && !hasPickToday(history, 'US', today)) {
  newEntries.push(makeEntry({ market: 'US', buyDate: today, pick: usPick, idPrefix }));
}
```

In all `console.log` lines, prepend the label for clarity. Example: change

```javascript
console.log(`[scan-picks] history now has ${history.length} entries (added ${newEntries.length})`);
```

to

```javascript
console.log(`[scan-picks/${label}] history now has ${history.length} entries (added ${newEntries.length})`);
```

Also change `[scan-picks] ${marketLabel}` (in `scanGroup`) — leave that helper alone, but be aware logs from it will not carry the track label. Acceptable.

- [ ] **Step 4: Add new `main` orchestrator**

After the `runTrack` function body, before `main().catch(...)`, add:

```javascript
async function main() {
  await runTrack({
    label: 'stocks',
    krUniverseFile: 'universe-kr.json',
    usUniverseFile: 'universe-us.json',
    outputPath: resolve(__dirname, '../src/data/picks.json'),
    historyPath: resolve(__dirname, '../src/data/picks-history.json'),
  });
  await runTrack({
    label: 'etfs',
    krUniverseFile: 'universe-etf-kr.json',
    usUniverseFile: 'universe-etf-us.json',
    outputPath: resolve(__dirname, '../src/data/picks-etf.json'),
    historyPath: resolve(__dirname, '../src/data/picks-history-etf.json'),
    idPrefix: 'etf-',
  });
}
```

Leave the existing `main().catch(...)` at the bottom unchanged.

- [ ] **Step 5: Smoke-test the file parses**

Run: `node --check scripts/scan-picks.mjs`
Expected: no output (success). Any syntax error will print here.

- [ ] **Step 6: Full regression test**

Run: `npm test`
Expected: all tests pass (no test imports this script).

- [ ] **Step 7: Commit**

```bash
git add scripts/scan-picks.mjs
git commit -m "refactor(scan): extract runTrack, add ETF track

Stocks track unchanged in behavior. New ETFs track scans
universe-etf-{kr,us}.json into picks-etf.json + picks-history-etf.json
with idPrefix='etf-' for unique entry IDs."
```

---

## Task 4: Refactor `backtest.mjs` to `runBacktestTrack` + add ETF call

**Files:**
- Modify: `scripts/backtest.mjs`

Mirror the Task 3 pattern. Extract `main()` body into `runBacktestTrack(opts)`, call twice.

- [ ] **Step 1: Open file**

Run: `head -100 scripts/backtest.mjs`
Note: `OUTPUT` constant and `SIM_START` are at top, `main()` at bottom.

- [ ] **Step 2: Replace constants**

Edit `scripts/backtest.mjs`. Find:

```javascript
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '../src/data/backtest.json');
const SIM_START = '2022-01-01';
```

Replace with:

```javascript
const __dirname = dirname(fileURLToPath(import.meta.url));
const SIM_START = '2022-01-01';
```

(Remove `OUTPUT`.)

- [ ] **Step 3: Rename `main` to `runBacktestTrack`**

Change the function declaration:

```javascript
async function runBacktestTrack({ label, krUniverseFile, usUniverseFile, outputPath }) {
```

Inside the body:
- Replace `loadJson('universe-kr.json')` → `loadJson(krUniverseFile)`.
- Replace `loadJson('universe-us.json')` → `loadJson(usUniverseFile)`.
- Replace `OUTPUT` → `outputPath`.
- Prepend `[${label}]` to console.log lines: change `[backtest]` to `[backtest/${label}]`.

- [ ] **Step 4: Add new `main` orchestrator**

Before `main().catch(...)` at the bottom, add:

```javascript
async function main() {
  await runBacktestTrack({
    label: 'stocks',
    krUniverseFile: 'universe-kr.json',
    usUniverseFile: 'universe-us.json',
    outputPath: resolve(__dirname, '../src/data/backtest.json'),
  });
  await runBacktestTrack({
    label: 'etfs',
    krUniverseFile: 'universe-etf-kr.json',
    usUniverseFile: 'universe-etf-us.json',
    outputPath: resolve(__dirname, '../src/data/backtest-etf.json'),
  });
}
```

- [ ] **Step 5: Syntax check**

Run: `node --check scripts/backtest.mjs`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add scripts/backtest.mjs
git commit -m "refactor(backtest): extract runBacktestTrack, add ETF track

Same simulate() + bucketize() pipeline run on universe-etf-{kr,us}.json
to produce src/data/backtest-etf.json."
```

---

## Task 5: Generate initial ETF picks data

**Files:**
- Generated: `src/data/picks-etf.json`
- Generated: `src/data/picks-history-etf.json`

Run the now-extended scanner once to produce the new ETF data files. This also serves as a smoke test of the Task 3 refactor.

- [ ] **Step 1: Run the scanner**

Run: `npm run scan:picks` (timeout 600000 ms / 10 min)

Expected stdout includes both `[scan-picks/stocks]` and `[scan-picks/etfs]` log blocks. Some `[fetch] HTTP 4xx for X` warnings are tolerable.

Capture the final two summary lines:
- `[scan-picks/stocks] wrote .../picks.json`
- `[scan-picks/etfs] wrote .../picks-etf.json`

- [ ] **Step 2: Verify outputs**

Run:

```bash
node -e "const s=require('./src/data/picks.json'); const e=require('./src/data/picks-etf.json'); console.log({stockKR:s.kr?.ticker??'none', stockUS:s.us?.ticker??'none', etfKR:e.kr?.ticker??'none', etfUS:e.us?.ticker??'none'})"
```

Expected: prints the four tickers (or 'none'). It is normal and acceptable for ETF picks to be `none` today — the universe is small and the filters are strict.

- [ ] **Step 3: Verify history files**

Run:

```bash
node -e "const s=require('./src/data/picks-history.json'); const e=require('./src/data/picks-history-etf.json'); console.log({stockEntries:s.length, etfEntries:e.length, etfFirstId:e[0]?.id??'(empty)'})"
```

Expected: `stockEntries` is the existing count (≥2). `etfEntries` is 0 if no ETF picks today, or ≥1. If ≥1, `etfFirstId` must start with `etf-`.

If `etfFirstId` does NOT start with `etf-`, **STOP** and report — Task 3 wiring of `idPrefix` is broken.

- [ ] **Step 4: Commit generated data**

```bash
git add src/data/picks.json src/data/picks-history.json src/data/picks-etf.json src/data/picks-history-etf.json
git commit -m "data: initial ETF picks snapshot + empty history"
```

(Stock files may also have been updated by today's scan — that's normal.)

---

## Task 6: Generate initial ETF backtest data

**Files:**
- Generated: `src/data/backtest-etf.json`

- [ ] **Step 1: Run backtest**

Run: `npm run backtest` (timeout 900000 ms / 15 min — usually completes in ~1–2 min)

Expected: stdout shows both `[backtest/stocks]` and `[backtest/etfs]` blocks. Two output writes.

- [ ] **Step 2: Sanity check ETF output**

Run:

```bash
node -e "const j=require('./src/data/backtest-etf.json'); console.log({simDays:j.simDays, totals:j.totals, byYear:Object.fromEntries(Object.entries(j.byYear).map(([k,v])=>[k,{count:v.count,winRate:v.winRate,meanReturn:v.meanReturn}]))})"
```

Expected:
- `simDays > 500`
- `totals.count` ≥ 0 (could be small or zero for ETFs — that itself is a finding)
- No NaN values anywhere
- byYear keys span 2022 through current year

If `simDays === 0` or the script errored, **STOP** and inspect — likely a Yahoo fetch issue or a date-range bug in the refactor.

- [ ] **Step 3: Verify file size reasonable**

Run:

```bash
node -e "const s=require('fs').statSync('./src/data/backtest-etf.json'); console.log('bytes:', s.size)"
```

Expected: under 200,000 bytes (ETF picks count likely lower than stocks).

- [ ] **Step 4: Commit**

```bash
git add src/data/backtest.json src/data/backtest-etf.json
git commit -m "data: initial ETF backtest output 2022-01-01 -> today"
```

(Stock backtest may also re-write with today's date in `asOf`; that's normal.)

---

## Task 7: Shared tab toggle client script

**Files:**
- Create: `src/scripts/track-tabs.ts`

A single script that pages can import to enable tab toggling between stock/ETF panels. Activates ALL toggle groups on the page that share an attribute namespace (`data-track-tab`, `data-track-panel`).

- [ ] **Step 1: Create the script**

Create `src/scripts/track-tabs.ts`:

```typescript
type Track = 'stock' | 'etf';

function activate(group: HTMLElement, target: Track) {
  const tabs = group.querySelectorAll<HTMLButtonElement>('[data-track-tab]');
  tabs.forEach((tab) => {
    const isActive = tab.dataset.trackTab === target;
    tab.classList.toggle('bg-slate-800', isActive);
    tab.classList.toggle('text-slate-100', isActive);
    tab.classList.toggle('text-slate-400', !isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  const groupId = group.dataset.trackGroup ?? '';
  const panels = document.querySelectorAll<HTMLElement>(
    `[data-track-panel][data-track-group="${groupId}"]`
  );
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.trackPanel !== target;
  });
}

function init() {
  const groups = document.querySelectorAll<HTMLElement>('[data-track-group][data-track-tabs]');
  groups.forEach((group) => {
    const tabs = group.querySelectorAll<HTMLButtonElement>('[data-track-tab]');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.trackTab as Track;
        activate(group, target);
      });
    });
    // Initial activation based on the first tab marked aria-selected="true",
    // or fall back to the first tab.
    const initial = (group.querySelector<HTMLButtonElement>('[data-track-tab][aria-selected="true"]') ??
      tabs[0]
    )?.dataset.trackTab as Track | undefined;
    if (initial) activate(group, initial);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/track-tabs.ts
git commit -m "feat(ui): shared stock/ETF tab toggle script"
```

---

## Task 8: `index.astro` tab toggle for picks

**Files:**
- Modify: `src/pages/index.astro`

Inside the existing `<section id="section-picks" hidden ...>`, insert a stock/ETF tab and two panels. Import `picks-etf.json`. Add `track-tabs.ts` to the script imports at the bottom.

- [ ] **Step 1: Add ETF data import**

Edit `src/pages/index.astro`. Find:

```astro
import picksData from '../data/picks.json';
```

Add immediately below:

```astro
import picksEtfData from '../data/picks-etf.json';
```

Find:

```astro
const { kr: krPick = null, us: usPick = null, asOf: picksAsOf } = picksData;
```

Add immediately below:

```astro
const { kr: krEtfPick = null, us: usEtfPick = null } = picksEtfData;
```

- [ ] **Step 2: Wrap picks markup in tab structure**

Find the existing block (lines 27–43 currently):

```astro
  <section id="section-picks" hidden class="space-y-6">
    <div class="space-y-3">
      <h2 class="text-sm uppercase tracking-wider text-slate-400">🇰🇷 한국</h2>
      {krPick ? (
        <PickCard {...krPick} />
      ) : (
        <p class="text-sm text-slate-400 text-center py-4">오늘은 조건 충족 종목 없음. 내일 다시 확인.</p>
      )}
    </div>
    <div class="space-y-3">
      <h2 class="text-sm uppercase tracking-wider text-slate-400">🇺🇸 미국</h2>
      {usPick ? (
        <PickCard {...usPick} />
      ) : (
        <p class="text-sm text-slate-400 text-center py-4">오늘은 조건 충족 종목 없음. 내일 다시 확인.</p>
      )}
    </div>
```

Replace with (the outer `<section id="section-picks" hidden class="space-y-6">` opening tag stays; only the inner content changes):

```astro
  <section id="section-picks" hidden class="space-y-6">
    <div data-track-tabs data-track-group="picks" class="flex gap-1 rounded-full bg-slate-900 p-1 border border-slate-800">
      <button data-track-tab="stock" aria-selected="true" class="flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-slate-100 bg-slate-800">종목</button>
      <button data-track-tab="etf" aria-selected="false" class="flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-slate-400">ETF</button>
    </div>

    <div data-track-panel="stock" data-track-group="picks" class="space-y-6">
      <div class="space-y-3">
        <h2 class="text-sm uppercase tracking-wider text-slate-400">🇰🇷 한국</h2>
        {krPick ? (
          <PickCard {...krPick} />
        ) : (
          <p class="text-sm text-slate-400 text-center py-4">오늘은 조건 충족 종목 없음. 내일 다시 확인.</p>
        )}
      </div>
      <div class="space-y-3">
        <h2 class="text-sm uppercase tracking-wider text-slate-400">🇺🇸 미국</h2>
        {usPick ? (
          <PickCard {...usPick} />
        ) : (
          <p class="text-sm text-slate-400 text-center py-4">오늘은 조건 충족 종목 없음. 내일 다시 확인.</p>
        )}
      </div>
    </div>

    <div data-track-panel="etf" data-track-group="picks" hidden class="space-y-6">
      <div class="space-y-3">
        <h2 class="text-sm uppercase tracking-wider text-slate-400">🇰🇷 한국 ETF</h2>
        {krEtfPick ? (
          <PickCard {...krEtfPick} />
        ) : (
          <p class="text-sm text-slate-400 text-center py-4">오늘은 조건 충족 ETF 없음.</p>
        )}
      </div>
      <div class="space-y-3">
        <h2 class="text-sm uppercase tracking-wider text-slate-400">🇺🇸 미국 ETF</h2>
        {usEtfPick ? (
          <PickCard {...usEtfPick} />
        ) : (
          <p class="text-sm text-slate-400 text-center py-4">오늘은 조건 충족 ETF 없음.</p>
        )}
      </div>
    </div>
```

(The two existing `<a href="/history/">` and `<a href="/stats">` links remain after this new structure, inside `section-picks`. Do not touch them.)

- [ ] **Step 3: Add track-tabs script import**

Find the bottom of the file:

```astro
  <script>
    import '../scripts/toggle.ts';
    import '../scripts/theme-tabs.ts';
  </script>
```

Add the new import:

```astro
  <script>
    import '../scripts/toggle.ts';
    import '../scripts/theme-tabs.ts';
    import '../scripts/track-tabs.ts';
  </script>
```

- [ ] **Step 4: Build verifies no Astro errors**

Run: `npm run build`
Expected: build succeeds, route list still includes `/`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(ui): stock/ETF tab toggle on index picks section"
```

---

## Task 9: `history.astro` tab toggle

**Files:**
- Modify: `src/pages/history.astro`

- [ ] **Step 1: Add ETF history import**

Edit `src/pages/history.astro`. Find:

```astro
import history from '../data/picks-history.json';
```

Add immediately below:

```astro
import historyEtf from '../data/picks-history-etf.json';
```

- [ ] **Step 2: Compute parallel ETF aggregations**

Find the existing computation block:

```astro
const sorted = [...history].sort((a, b) => b.buyDate.localeCompare(a.buyDate));
const holdingCount = sorted.filter((e) => e.status === 'holding').length;
const soldCount = sorted.filter((e) => e.status === 'sold').length;

const shortCount = sorted.filter((e) => e.horizon === '단기').length;
const midCount   = sorted.filter((e) => e.horizon === '중기').length;
const longCount  = sorted.filter((e) => e.horizon === '장기').length;
```

Replace with:

```astro
function summarize(rows) {
  const sorted = [...rows].sort((a, b) => b.buyDate.localeCompare(a.buyDate));
  return {
    sorted,
    holdingCount: sorted.filter((e) => e.status === 'holding').length,
    soldCount: sorted.filter((e) => e.status === 'sold').length,
    shortCount: sorted.filter((e) => e.horizon === '단기').length,
    midCount: sorted.filter((e) => e.horizon === '중기').length,
    longCount: sorted.filter((e) => e.horizon === '장기').length,
  };
}

const stockSummary = summarize(history);
const etfSummary = summarize(historyEtf);
```

- [ ] **Step 3: Replace body markup**

Find the existing body inside `<Base>`:

```astro
  <h1 class="text-xl font-bold mb-1">픽 히스토리</h1>
  <p class="text-xs text-slate-400 mb-4">총 {sorted.length}건 · 보유중 {holdingCount} · 매도완료 {soldCount}</p>

  <div class="flex gap-1 mb-3 text-xs flex-wrap">
    <span class="px-2 py-1 rounded-full bg-horizon-short/20 text-horizon-short font-semibold">단기 {shortCount}</span>
    <span class="px-2 py-1 rounded-full bg-horizon-mid/20 text-horizon-mid font-semibold">중기 {midCount}</span>
    <span class="px-2 py-1 rounded-full bg-horizon-long/20 text-horizon-long font-semibold">장기 {longCount}</span>
  </div>

  {sorted.length === 0 ? (
    <p class="text-sm text-slate-400 text-center py-8">아직 적재된 픽 없음. <code>npm run scan:picks</code> 한 번 실행.</p>
  ) : (
    <div class="space-y-3">
      {sorted.map((entry) => <HistoryRow entry={entry} />)}
    </div>
  )}
```

Replace with:

```astro
  <h1 class="text-xl font-bold mb-3">픽 히스토리</h1>

  <div data-track-tabs data-track-group="history" class="flex gap-1 mb-4 rounded-full bg-slate-900 p-1 border border-slate-800">
    <button data-track-tab="stock" aria-selected="true" class="flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-slate-100 bg-slate-800">종목 ({stockSummary.sorted.length})</button>
    <button data-track-tab="etf" aria-selected="false" class="flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-slate-400">ETF ({etfSummary.sorted.length})</button>
  </div>

  <div data-track-panel="stock" data-track-group="history">
    <p class="text-xs text-slate-400 mb-3">보유중 {stockSummary.holdingCount} · 매도완료 {stockSummary.soldCount}</p>
    <div class="flex gap-1 mb-3 text-xs flex-wrap">
      <span class="px-2 py-1 rounded-full bg-horizon-short/20 text-horizon-short font-semibold">단기 {stockSummary.shortCount}</span>
      <span class="px-2 py-1 rounded-full bg-horizon-mid/20 text-horizon-mid font-semibold">중기 {stockSummary.midCount}</span>
      <span class="px-2 py-1 rounded-full bg-horizon-long/20 text-horizon-long font-semibold">장기 {stockSummary.longCount}</span>
    </div>
    {stockSummary.sorted.length === 0 ? (
      <p class="text-sm text-slate-400 text-center py-8">아직 적재된 픽 없음. <code>npm run scan:picks</code> 한 번 실행.</p>
    ) : (
      <div class="space-y-3">
        {stockSummary.sorted.map((entry) => <HistoryRow entry={entry} />)}
      </div>
    )}
  </div>

  <div data-track-panel="etf" data-track-group="history" hidden>
    <p class="text-xs text-slate-400 mb-3">보유중 {etfSummary.holdingCount} · 매도완료 {etfSummary.soldCount}</p>
    <div class="flex gap-1 mb-3 text-xs flex-wrap">
      <span class="px-2 py-1 rounded-full bg-horizon-short/20 text-horizon-short font-semibold">단기 {etfSummary.shortCount}</span>
      <span class="px-2 py-1 rounded-full bg-horizon-mid/20 text-horizon-mid font-semibold">중기 {etfSummary.midCount}</span>
      <span class="px-2 py-1 rounded-full bg-horizon-long/20 text-horizon-long font-semibold">장기 {etfSummary.longCount}</span>
    </div>
    {etfSummary.sorted.length === 0 ? (
      <p class="text-sm text-slate-400 text-center py-8">아직 적재된 ETF 픽 없음. ETF universe가 작아 며칠 기다려야 첫 픽이 잡힐 수 있음.</p>
    ) : (
      <div class="space-y-3">
        {etfSummary.sorted.map((entry) => <HistoryRow entry={entry} />)}
      </div>
    )}
  </div>

  <script>
    import '../scripts/track-tabs.ts';
  </script>
```

- [ ] **Step 4: Build verifies**

Run: `npm run build`
Expected: success, `/history` in route list.

- [ ] **Step 5: Commit**

```bash
git add src/pages/history.astro
git commit -m "feat(ui): stock/ETF tab on /history"
```

---

## Task 10: `picks/[id].astro` static path union

**Files:**
- Modify: `src/pages/picks/[id].astro`

`getStaticPaths()` currently only enumerates `picks-history.json`. Union with `picks-history-etf.json` so detail pages exist for ETF entries too. Entry shape is identical; the ID prefix (`etf-`) makes IDs globally unique.

- [ ] **Step 1: Add ETF history import**

Edit `src/pages/picks/[id].astro`. Find:

```astro
import history from '../../data/picks-history.json';
```

Add immediately below:

```astro
import historyEtf from '../../data/picks-history-etf.json';
```

- [ ] **Step 2: Union the two arrays in `getStaticPaths`**

Find:

```astro
export function getStaticPaths() {
  return history.map((entry) => ({
    params: { id: entry.id },
    props: { entry },
  }));
}
```

Replace with:

```astro
export function getStaticPaths() {
  return [...history, ...historyEtf].map((entry) => ({
    params: { id: entry.id },
    props: { entry },
  }));
}
```

No other changes — the rest of the file already renders generic entry fields and works for both tracks unchanged.

- [ ] **Step 3: Build verifies**

Run: `npm run build`
Expected: success. Build output should show one route per history entry across both files.

- [ ] **Step 4: Commit**

```bash
git add src/pages/picks/[id].astro
git commit -m "feat(ui): picks/[id] static paths include ETF entries"
```

---

## Task 11: `stats.astro` tab toggle for backtest

**Files:**
- Modify: `src/pages/stats.astro`

- [ ] **Step 1: Add ETF backtest import + parallel computations**

Edit `src/pages/stats.astro`. Find:

```astro
import backtest from '../data/backtest.json';

const { window: winRange, simDays, totals, byMarket, byHorizon, byMarketHorizon, byYear, picks } = backtest;
```

Replace with:

```astro
import backtestStocks from '../data/backtest.json';
import backtestEtf from '../data/backtest-etf.json';

function bind(b: any) {
  const yearRows = Object.entries(b.byYear)
    .sort(([a], [c]) => a.localeCompare(c))
    .map(([year, v]: any) => ({ label: year, ...v }));
  const horizonRows = ['단기', '중기', '장기'].map((h) => ({ label: h, ...b.byHorizon[h] }));
  const marketRows = ['KR', 'US'].map((m) => ({ label: m, ...b.byMarket[m] }));
  const marketHorizonRows = Object.entries(b.byMarketHorizon).map(([k, v]: any) => ({ label: k, ...v }));
  const picksMatured = b.picks.filter((p: any) => p.status === 'matured');
  return { ...b, yearRows, horizonRows, marketRows, marketHorizonRows, picksMatured };
}

const stocks = bind(backtestStocks);
const etfs = bind(backtestEtf);
```

Remove the standalone destructure of `backtest` (the `const { window: winRange, ... } = backtest;` line) and the standalone `yearRows`/`horizonRows`/`marketRows`/`marketHorizonRows`/`picksMatured` constants that follow it.

The `fmtPct`, `fmtReturn`, `returnColor` helpers stay as-is (they don't depend on which track is rendered).

- [ ] **Step 2: Replace body with two-panel structure**

Find the entire `<Base ...>` block body (from `<header>` through `</p>` of the disclaimer at the end). Replace with:

```astro
<Base title="surgePick — 백테스트">
  <div class="space-y-4">
    <header class="flex items-baseline justify-between">
      <h1 class="text-xl font-bold text-slate-100">📊 백테스트 결과</h1>
      <a href="/" class="text-xs text-slate-400 hover:text-slate-200">← 홈</a>
    </header>

    <div data-track-tabs data-track-group="bt" class="flex gap-1 rounded-full bg-slate-900 p-1 border border-slate-800">
      <button data-track-tab="stock" aria-selected="true" class="flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-slate-100 bg-slate-800">종목</button>
      <button data-track-tab="etf" aria-selected="false" class="flex-1 rounded-full px-3 py-1.5 text-xs font-medium text-slate-400">ETF</button>
    </div>

    <div data-track-panel="stock" data-track-group="bt" class="space-y-4">
      <p class="text-xs text-slate-400">
        기간: <span class="font-medium text-slate-200">{stocks.window.start} → {stocks.window.end}</span>
        · 시뮬레이션 거래일 <span class="font-medium text-slate-200">{stocks.simDays}</span>일
      </p>

      <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 class="mb-2 text-sm font-semibold text-slate-700">전체 요약</h2>
        <div class="grid grid-cols-4 gap-2 text-center">
          <div><div class="text-[10px] text-slate-500">건수</div><div class="text-lg font-bold text-slate-900 tabular-nums">{stocks.totals.count}</div></div>
          <div><div class="text-[10px] text-slate-500">진입률</div><div class="text-lg font-bold text-slate-900 tabular-nums">{fmtPct(stocks.totals.pickRate, 1)}</div></div>
          <div><div class="text-[10px] text-slate-500">승률</div><div class="text-lg font-bold text-slate-900 tabular-nums">{fmtPct(stocks.totals.winRate, 1)}</div></div>
          <div><div class="text-[10px] text-slate-500">평균 수익</div><div class={`text-lg font-bold tabular-nums ${returnColor(stocks.totals.meanReturn)}`}>{fmtReturn(stocks.totals.meanReturn)}</div></div>
        </div>
        {stocks.totals.active > 0 && (
          <p class="mt-2 text-[10px] text-slate-400">보유 중(만기 미도달) {stocks.totals.active}건은 집계 제외.</p>
        )}
      </section>

      <StatsTable title="연도별" rows={stocks.yearRows} highlightLabel="2022" />
      <StatsTable title="보유기간별" rows={stocks.horizonRows} />
      <StatsTable title="시장별" rows={stocks.marketRows} />
      <StatsTable title="시장 × 보유기간" rows={stocks.marketHorizonRows} />

      <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 class="mb-3 text-sm font-semibold text-slate-700">전체 픽 ({stocks.picksMatured.length})</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead><tr class="border-b border-slate-200 text-left text-slate-500"><th class="py-2 pr-2 font-medium">매수일</th><th class="py-2 pr-2 font-medium">종목</th><th class="py-2 pr-2 text-right font-medium">기간</th><th class="py-2 text-right font-medium">수익률</th></tr></thead>
            <tbody>
              {stocks.picksMatured.map((p: any) => (
                <tr class="border-b border-slate-100 last:border-0">
                  <td class="py-2 pr-2 tabular-nums text-slate-600">{p.buyDate}</td>
                  <td class="py-2 pr-2"><span class="font-medium text-slate-800">{p.ticker}</span><span class="ml-1 text-[10px] text-slate-400">{p.market}·{p.horizon}</span></td>
                  <td class="py-2 pr-2 text-right tabular-nums text-slate-500">{p.holdDays}d</td>
                  <td class={`py-2 text-right tabular-nums font-medium ${returnColor(p.return)}`}>{fmtReturn(p.return)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div data-track-panel="etf" data-track-group="bt" hidden class="space-y-4">
      <p class="text-xs text-slate-400">
        기간: <span class="font-medium text-slate-200">{etfs.window.start} → {etfs.window.end}</span>
        · 시뮬레이션 거래일 <span class="font-medium text-slate-200">{etfs.simDays}</span>일
      </p>

      <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 class="mb-2 text-sm font-semibold text-slate-700">전체 요약</h2>
        <div class="grid grid-cols-4 gap-2 text-center">
          <div><div class="text-[10px] text-slate-500">건수</div><div class="text-lg font-bold text-slate-900 tabular-nums">{etfs.totals.count}</div></div>
          <div><div class="text-[10px] text-slate-500">진입률</div><div class="text-lg font-bold text-slate-900 tabular-nums">{fmtPct(etfs.totals.pickRate, 1)}</div></div>
          <div><div class="text-[10px] text-slate-500">승률</div><div class="text-lg font-bold text-slate-900 tabular-nums">{fmtPct(etfs.totals.winRate, 1)}</div></div>
          <div><div class="text-[10px] text-slate-500">평균 수익</div><div class={`text-lg font-bold tabular-nums ${returnColor(etfs.totals.meanReturn)}`}>{fmtReturn(etfs.totals.meanReturn)}</div></div>
        </div>
        {etfs.totals.active > 0 && (
          <p class="mt-2 text-[10px] text-slate-400">보유 중(만기 미도달) {etfs.totals.active}건은 집계 제외.</p>
        )}
      </section>

      <StatsTable title="연도별" rows={etfs.yearRows} highlightLabel="2022" />
      <StatsTable title="보유기간별" rows={etfs.horizonRows} />
      <StatsTable title="시장별" rows={etfs.marketRows} />
      <StatsTable title="시장 × 보유기간" rows={etfs.marketHorizonRows} />

      <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 class="mb-3 text-sm font-semibold text-slate-700">전체 픽 ({etfs.picksMatured.length})</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead><tr class="border-b border-slate-200 text-left text-slate-500"><th class="py-2 pr-2 font-medium">매수일</th><th class="py-2 pr-2 font-medium">종목</th><th class="py-2 pr-2 text-right font-medium">기간</th><th class="py-2 text-right font-medium">수익률</th></tr></thead>
            <tbody>
              {etfs.picksMatured.map((p: any) => (
                <tr class="border-b border-slate-100 last:border-0">
                  <td class="py-2 pr-2 tabular-nums text-slate-600">{p.buyDate}</td>
                  <td class="py-2 pr-2"><span class="font-medium text-slate-800">{p.ticker}</span><span class="ml-1 text-[10px] text-slate-400">{p.market}·{p.horizon}</span></td>
                  <td class="py-2 pr-2 text-right tabular-nums text-slate-500">{p.holdDays}d</td>
                  <td class={`py-2 text-right tabular-nums font-medium ${returnColor(p.return)}`}>{fmtReturn(p.return)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <p class="text-[10px] leading-relaxed text-slate-400">
      ⓘ 한계: 종목/ETF 풀이 2026년 기준으로 고정되어 있어 생존편향(survivorship bias)이 존재합니다.
      과거 시점에 상장폐지된 종목은 포함되지 않으며, 결과는 알고리즘 자체의 동작 검증 목적입니다.
    </p>
  </div>

  <script>
    import '../scripts/track-tabs.ts';
  </script>
</Base>
```

- [ ] **Step 2.5: Build verifies**

Run: `npm run build`
Expected: success, `/stats` in route list.

- [ ] **Step 3: Commit**

```bash
git add src/pages/stats.astro
git commit -m "feat(ui): stock/ETF tab on /stats backtest page"
```

---

## Task 12: Push + Vercel verify

**Files:** none

- [ ] **Step 1: Sync with remote**

Run: `git pull --rebase`
Expected: clean rebase or no-op. If a cron commit landed during this work, the rebase handles it.

- [ ] **Step 2: Push**

Run: `git push`
Expected: `... main -> main` success line, no force, no hook skipping.

- [ ] **Step 3: Wait for Vercel rebuild**

Wait ~45 seconds for Vercel to detect the push, build, and deploy.

- [ ] **Step 4: Verify /**

WebFetch https://surge-pick.vercel.app/ and confirm:
- Page returns 200.
- The picks section (after clicking 오늘의 급등픽) contains both `종목` and `ETF` tab buttons (`data-track-tab="stock"` / `="etf"`).

(Note: server-rendered HTML will contain both panels; the ETF panel is `hidden` initially. The buttons must be present in raw HTML to count as a pass.)

- [ ] **Step 5: Verify /history**

WebFetch https://surge-pick.vercel.app/history and confirm:
- 200 status.
- Both tab buttons present (`종목 (N)` and `ETF (N)`).
- Stock list rows render.

- [ ] **Step 6: Verify /stats**

WebFetch https://surge-pick.vercel.app/stats and confirm:
- 200 status.
- Both tab buttons present.
- Stock panel summary card shows non-zero counts.
- ETF panel summary card present (counts may be 0 or small).

- [ ] **Step 7: Verify a picks/[id] route (stock + ETF if any)**

If `src/data/picks-history-etf.json` is non-empty, pick the first entry's `id` and WebFetch `https://surge-pick.vercel.app/picks/<that-id>/`.

Run locally to get an ID:

```bash
node -e "const e=require('./src/data/picks-history-etf.json'); console.log(e[0]?.id ?? '(empty)')"
```

If an ID is printed: WebFetch the URL and confirm 200. If `(empty)`, skip this step (universe-etf hasn't produced its first pick yet — expected).

Also pick a known stock ID from `picks-history.json` and WebFetch to confirm legacy IDs still resolve unchanged.

---

## Self-Review Notes

- **Spec coverage:** Each spec section (universes, scan refactor, backtest refactor, ID policy, tab UI, file-level change list) maps to one or more tasks 1–11. Deploy verification is task 12.
- **History store change** (spec section "ID policy") is covered by Task 2, with test assertion that `idPrefix` produces `etf-` prefixed IDs and that the default path is unchanged.
- **Tab toggle** uses a single shared script (Task 7) consumed by 3 pages (Tasks 8, 9, 11). DRY satisfied.
- **No algorithm changes** — Tasks 3, 4 are refactors only. Tasks 5, 6 re-run the existing algorithm on a new universe and write new files; no `scoring.mjs`, `horizon.mjs`, or `backtest-engine.mjs` edits.
- **Tests** — Task 2 adds 2 assertions to `history-store.test.mjs`. No other test files change. All other tasks rely on `npm test` + `npm run build` for regression and `WebFetch` for live verification.
- **Idempotency** — `scan:picks` is safe to re-run (existing `hasPickToday` check). `backtest` is deterministic on given data. Re-running Task 5 / Task 6 will not corrupt state.
- **CI** — `scan.yml` cron untouched. After the first manual `npm run scan:picks` populates the new files, future cron runs append ETF entries automatically.
- **Risks called out in spec** — small ETF sample (KR 9), TQQQ/SQQQ filter rejection, 2022 ETF backtest signal — all are observational, not blocking. Plan ships the feature; outcomes are findings.
