# CWC v2 Portfolio Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert surgePick from per-pick momentum picker into a portfolio simulator that watches universe tickers, buys on pullback (RSI<35 + near MA200) via 3-chunk DCA, sells on extension via 3-chunk distribution, gates risk via 5-tier exit, and tracks equity over time.

**Architecture:** Five new pure libraries (valuation, dca-plan, exit-rules, portfolio, plus rewritten backtest-engine) compose into a daily-driven portfolio simulator. Initial capital KRW 10M + USD 10K. Backtest produces equity curve + CAGR/MDD/Sharpe. Live `scan-picks` becomes a state-advancing scanner that mutates persisted `portfolio.json`. Stock + ETF universes merge into a single per-market pool (5 concurrent slots per market).

**Tech Stack:** Node 20 ESM, Vitest, Astro 4. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-05-28-cwc-portfolio-design.md`

---

## File Map

```
surgePick/
├── scripts/
│   ├── lib/
│   │   ├── valuation.mjs              # Task 1 — RSI, MA, CHEAP/RICH tag
│   │   ├── dca-plan.mjs               # Task 2 — DCA + distribution scheduler
│   │   ├── exit-rules.mjs             # Task 3 — 5-tier risk gate evaluator
│   │   ├── portfolio.mjs              # Task 4 — state init/buy/sell/equity
│   │   ├── backtest-engine.mjs        # Task 5 — REWRITE — portfolio sim driver
│   │   └── backtest-aggregate.mjs     # Task 6 — extend with CAGR/MDD/Sharpe
│   ├── backtest.mjs                   # Task 7 — single merged pool per market
│   └── scan-picks.mjs                 # Task 12 — state-advancing scanner
├── src/
│   ├── components/
│   │   ├── EquityCurve.astro          # Task 8 — SVG line chart
│   │   └── PositionRow.astro          # Task 8 — open position row
│   ├── pages/
│   │   ├── portfolio.astro            # Task 9 — equity curve + positions
│   │   ├── watchlist.astro            # Task 10 — today CHEAP/NEUTRAL/RICH
│   │   ├── stats.astro                # Task 11 — replace per-pick with CAGR/MDD
│   │   └── index.astro                # Task 11 — today actions + nav links
│   └── data/
│       ├── portfolio.json             # Task 7 (generated)
│       ├── watchlist.json             # Task 12 (generated)
│       └── backtest.json              # Task 7 (repurposed)
└── tests/
    ├── valuation.test.mjs             # Task 1
    ├── dca-plan.test.mjs              # Task 2
    ├── exit-rules.test.mjs            # Task 3
    ├── portfolio.test.mjs             # Task 4
    ├── backtest-engine.test.mjs       # Task 5 — REWRITE
    └── backtest-aggregate.test.mjs    # Task 6 — extend
```

Stock + ETF universes merge per market in Task 7 (single pool). Old `backtest-etf.json`, `picks-etf.json`, `picks-history-etf.json` deprecated (deleted in Task 13).

---

## Task 1: `valuation.mjs` — RSI / MA / tagging — TDD

**Files:**
- Create: `scripts/lib/valuation.mjs`
- Create: `tests/valuation.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/valuation.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { rsi, sma, valuationTag } from '../scripts/lib/valuation.mjs';

describe('sma', () => {
  it('mean of last N values ending at endIdx', () => {
    const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(sma(closes, 9, 5)).toBe(8);
    expect(sma(closes, 4, 5)).toBe(3);
  });
  it('NaN when insufficient', () => {
    expect(Number.isNaN(sma([1, 2, 3], 2, 5))).toBe(true);
  });
});

describe('rsi', () => {
  it('returns ~70 on monotonic uptrend (overbought)', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const r = rsi(closes, 14);
    expect(r).toBeGreaterThan(95);
  });
  it('returns ~30 on monotonic downtrend (oversold)', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 130 - i);
    const r = rsi(closes, 14);
    expect(r).toBeLessThan(5);
  });
  it('returns ~50 on flat series', () => {
    const closes = Array.from({ length: 30 }, () => 100);
    const r = rsi(closes, 14);
    expect(r).toBeCloseTo(50, 0);
  });
  it('NaN when insufficient history', () => {
    expect(Number.isNaN(rsi([1, 2, 3], 14))).toBe(true);
  });
});

describe('valuationTag', () => {
  it('cheap: RSI<35 + within 10% of MA200', () => {
    // Synthetic: prior 200 days rising to 120, then drop to 100 (close to MA200 ~110, oversold)
    const rising = Array.from({ length: 200 }, (_, i) => 100 + i * 0.1);
    const drop = [115, 114, 113, 110, 108, 105, 103, 102, 101, 100, 99, 98, 97, 96, 95];
    const closes = [...rising, ...drop];
    expect(valuationTag(closes)).toBe('cheap');
  });
  it('rich: RSI>70', () => {
    const flat = Array.from({ length: 200 }, () => 100);
    const surge = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    const closes = [...flat, ...surge];
    expect(valuationTag(closes)).toBe('rich');
  });
  it('rich: price > MA200 × 1.20 (even with moderate RSI)', () => {
    const closes = Array.from({ length: 220 }, (_, i) => 100 + i * 0.5);
    expect(valuationTag(closes)).toBe('rich');
  });
  it('neutral otherwise', () => {
    const closes = Array.from({ length: 220 }, (_, i) => 100 + Math.sin(i / 5));
    expect(valuationTag(closes)).toBe('neutral');
  });
  it('neutral when insufficient history', () => {
    expect(valuationTag([100, 101, 102])).toBe('neutral');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npx vitest run tests/valuation.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`scripts/lib/valuation.mjs`:

```js
/**
 * Simple moving average of the last N values ending at endIdx (inclusive).
 */
export function sma(closes, endIdx, window) {
  if (endIdx < window - 1) return NaN;
  let sum = 0;
  for (let i = endIdx - window + 1; i <= endIdx; i++) sum += closes[i];
  return sum / window;
}

/**
 * Wilder's RSI(period) over the full series, returns latest value.
 * NaN if closes.length <= period.
 */
export function rsi(closes, period = 14) {
  if (closes.length <= period) return NaN;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Return CHEAP / RICH / NEUTRAL tag for the latest close.
 * cheap: rsi<35 AND |price - ma200| / ma200 < 0.10
 * rich:  rsi>70 OR price > ma200 * 1.20
 * neutral: otherwise (also when insufficient history)
 */
export function valuationTag(closes) {
  if (closes.length < 201) return 'neutral';
  const endIdx = closes.length - 1;
  const price = closes[endIdx];
  const ma200 = sma(closes, endIdx, 200);
  if (Number.isNaN(ma200)) return 'neutral';
  const rsiVal = rsi(closes, 14);
  if (Number.isNaN(rsiVal)) return 'neutral';
  const distance = Math.abs(price - ma200) / ma200;
  if (rsiVal > 70 || price > ma200 * 1.20) return 'rich';
  if (rsiVal < 35 && distance < 0.10) return 'cheap';
  return 'neutral';
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run tests/valuation.test.mjs`
Expected: PASS (all 11 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/valuation.mjs tests/valuation.test.mjs
git commit -m "feat(valuation): RSI, MA, CHEAP/RICH tagging

Wilder's RSI(14), SMA(N), and three-state valuation tag based on
RSI thresholds + distance from MA200. Insufficient history (<201
closes) returns neutral."
```

---

## Task 2: `dca-plan.mjs` — DCA + distribution scheduling — TDD

**Files:**
- Create: `scripts/lib/dca-plan.mjs`
- Create: `tests/dca-plan.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/dca-plan.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { createDcaPlan, createDistPlan, chunkDueOn, abortIfSignalChanged } from '../scripts/lib/dca-plan.mjs';

describe('createDcaPlan', () => {
  it('creates 3-chunk plan with day 1, day 6, day 11 schedule', () => {
    const plan = createDcaPlan({ startDate: '2024-01-02', totalShares: 30 });
    expect(plan.chunks).toEqual([
      { date: '2024-01-02', shares: 10, filled: false },
      { date: '2024-01-09', shares: 10, filled: false },
      { date: '2024-01-16', shares: 10, filled: false },
    ]);
    expect(plan.kind).toBe('dca');
  });
  it('rounds shares with last chunk absorbing remainder', () => {
    const plan = createDcaPlan({ startDate: '2024-01-02', totalShares: 10 });
    expect(plan.chunks.map((c) => c.shares)).toEqual([3, 3, 4]);
  });
});

describe('createDistPlan', () => {
  it('33/33/34 fraction split with 5-day spacing', () => {
    const plan = createDistPlan({ startDate: '2024-01-02', totalShares: 100 });
    expect(plan.chunks.map((c) => c.shares)).toEqual([33, 33, 34]);
    expect(plan.kind).toBe('dist');
  });
});

describe('chunkDueOn', () => {
  it('returns next unfilled chunk if date matches', () => {
    const plan = createDcaPlan({ startDate: '2024-01-02', totalShares: 30 });
    const due = chunkDueOn(plan, '2024-01-09');
    expect(due?.shares).toBe(10);
    expect(due?.date).toBe('2024-01-09');
  });
  it('returns next unfilled chunk if date >= scheduled date', () => {
    const plan = createDcaPlan({ startDate: '2024-01-02', totalShares: 30 });
    plan.chunks[0].filled = true;
    expect(chunkDueOn(plan, '2024-01-10')?.shares).toBe(10);
  });
  it('returns null if no chunks due', () => {
    const plan = createDcaPlan({ startDate: '2024-01-02', totalShares: 30 });
    plan.chunks[0].filled = true;
    expect(chunkDueOn(plan, '2024-01-03')).toBe(null);
  });
});

describe('abortIfSignalChanged', () => {
  it('aborts DCA when signal becomes rich', () => {
    const plan = createDcaPlan({ startDate: '2024-01-02', totalShares: 30 });
    expect(abortIfSignalChanged(plan, 'rich')).toBe(true);
  });
  it('aborts DCA when signal becomes neutral', () => {
    const plan = createDcaPlan({ startDate: '2024-01-02', totalShares: 30 });
    expect(abortIfSignalChanged(plan, 'neutral')).toBe(true);
  });
  it('does not abort DCA while signal stays cheap', () => {
    const plan = createDcaPlan({ startDate: '2024-01-02', totalShares: 30 });
    expect(abortIfSignalChanged(plan, 'cheap')).toBe(false);
  });
  it('aborts distribution when signal becomes cheap or neutral', () => {
    const plan = createDistPlan({ startDate: '2024-01-02', totalShares: 100 });
    expect(abortIfSignalChanged(plan, 'cheap')).toBe(true);
    expect(abortIfSignalChanged(plan, 'neutral')).toBe(true);
    expect(abortIfSignalChanged(plan, 'rich')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npx vitest run tests/dca-plan.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

`scripts/lib/dca-plan.mjs`:

```js
function addCalendarDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function splitInto3(total) {
  const base = Math.floor(total / 3);
  return [base, base, total - base * 2];
}

/**
 * Create a 3-chunk DCA buy plan over 10 calendar days (chunks at +0, +7, +14).
 * shares split as floor/floor/remainder.
 */
export function createDcaPlan({ startDate, totalShares }) {
  const [s1, s2, s3] = splitInto3(totalShares);
  return {
    kind: 'dca',
    startDate,
    chunks: [
      { date: startDate, shares: s1, filled: false },
      { date: addCalendarDays(startDate, 7), shares: s2, filled: false },
      { date: addCalendarDays(startDate, 14), shares: s3, filled: false },
    ],
  };
}

/**
 * Create a 3-chunk distribution sell plan.
 * shares: 33% / 33% / 34% (last absorbs remainder).
 */
export function createDistPlan({ startDate, totalShares }) {
  const s1 = Math.floor(totalShares * 0.33);
  const s2 = Math.floor(totalShares * 0.33);
  const s3 = totalShares - s1 - s2;
  return {
    kind: 'dist',
    startDate,
    chunks: [
      { date: startDate, shares: s1, filled: false },
      { date: addCalendarDays(startDate, 7), shares: s2, filled: false },
      { date: addCalendarDays(startDate, 14), shares: s3, filled: false },
    ],
  };
}

/**
 * Return the next unfilled chunk whose scheduled date <= currentDate, else null.
 */
export function chunkDueOn(plan, currentDate) {
  for (const c of plan.chunks) {
    if (!c.filled && c.date <= currentDate) return c;
  }
  return null;
}

/**
 * DCA aborts if signal flips off 'cheap'. Distribution aborts if signal flips off 'rich'.
 */
export function abortIfSignalChanged(plan, currentTag) {
  if (plan.kind === 'dca') return currentTag !== 'cheap';
  if (plan.kind === 'dist') return currentTag !== 'rich';
  return false;
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run tests/dca-plan.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/dca-plan.mjs tests/dca-plan.test.mjs
git commit -m "feat(dca-plan): 3-chunk DCA + distribution scheduler

Schedule 3 chunks over 14 calendar days (day 0, +7, +14).
abortIfSignalChanged() flips false when signal flips off the
direction (cheap for DCA, rich for distribution)."
```

---

## Task 3: `exit-rules.mjs` — 5-tier risk gate — TDD

**Files:**
- Create: `scripts/lib/exit-rules.mjs`
- Create: `tests/exit-rules.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/exit-rules.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { evaluateExit } from '../scripts/lib/exit-rules.mjs';

describe('evaluateExit', () => {
  it('gate 1 catastrophe fires when close < avgCost * 0.90', () => {
    const r = evaluateExit({ close: 89, avgCost: 100, peak: 100, isBear: false, holdingDays: 30 });
    expect(r).toEqual({ fire: true, reason: 'catastrophe' });
  });
  it('gate 2 trailing fires when close < peak * 0.92', () => {
    const r = evaluateExit({ close: 91, avgCost: 100, peak: 100, isBear: false, holdingDays: 30 });
    expect(r).toEqual({ fire: true, reason: 'trailing' });
  });
  it('gate 3 tight-trailing fires when gain >= 0.20 and close < peak * 0.96', () => {
    const r = evaluateExit({ close: 124, avgCost: 100, peak: 130, isBear: false, holdingDays: 30 });
    expect(r).toEqual({ fire: true, reason: 'trailing-tight' });
  });
  it('gate 3 supersedes gate 2 when both could fire', () => {
    const r = evaluateExit({ close: 119, avgCost: 100, peak: 130, isBear: false, holdingDays: 30 });
    expect(r.reason).toBe('trailing-tight');
  });
  it('gate 4 bear-flip fires when isBear', () => {
    const r = evaluateExit({ close: 100, avgCost: 100, peak: 100, isBear: true, holdingDays: 30 });
    expect(r).toEqual({ fire: true, reason: 'bear-flip' });
  });
  it('gate 5 time-stop fires after 365 holding days', () => {
    const r = evaluateExit({ close: 100, avgCost: 100, peak: 100, isBear: false, holdingDays: 366 });
    expect(r).toEqual({ fire: true, reason: 'time-stop' });
  });
  it('gate 1 supersedes gate 4 when both apply', () => {
    const r = evaluateExit({ close: 80, avgCost: 100, peak: 100, isBear: true, holdingDays: 30 });
    expect(r.reason).toBe('catastrophe');
  });
  it('no fire when nothing breached', () => {
    const r = evaluateExit({ close: 95, avgCost: 100, peak: 100, isBear: false, holdingDays: 30 });
    expect(r).toEqual({ fire: false, reason: null });
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npx vitest run tests/exit-rules.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

`scripts/lib/exit-rules.mjs`:

```js
/**
 * Evaluate exit gates against a position state.
 * Inputs:
 *   close        current close
 *   avgCost      average cost basis
 *   peak         max close since first buy
 *   isBear       bear regime flag at this date for the position's market
 *   holdingDays  calendar days since first buy
 * Returns { fire: bool, reason: 'catastrophe'|'trailing'|'trailing-tight'|'bear-flip'|'time-stop'|null }
 * Priority (first match wins): catastrophe > trailing-tight > trailing > bear-flip > time-stop.
 */
export function evaluateExit({ close, avgCost, peak, isBear, holdingDays }) {
  // 1. catastrophe — close < avgCost * 0.90
  if (close < avgCost * 0.90) {
    return { fire: true, reason: 'catastrophe' };
  }
  // gain measured against avgCost (realistic, since DCA averaged in)
  const gain = (peak - avgCost) / avgCost;
  // 3. tight trailing (must check before plain trailing — tighter band fires first when both apply)
  if (gain >= 0.20 && close < peak * 0.96) {
    return { fire: true, reason: 'trailing-tight' };
  }
  // 2. plain trailing
  if (close < peak * 0.92) {
    return { fire: true, reason: 'trailing' };
  }
  // 4. bear flip
  if (isBear) {
    return { fire: true, reason: 'bear-flip' };
  }
  // 5. time stop
  if (holdingDays > 365) {
    return { fire: true, reason: 'time-stop' };
  }
  return { fire: false, reason: null };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run tests/exit-rules.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/exit-rules.mjs tests/exit-rules.test.mjs
git commit -m "feat(exit-rules): 5-tier risk gate evaluator

Priority: catastrophe (close < avgCost*0.90) > trailing-tight
(gain>=20% & close < peak*0.96) > trailing (close < peak*0.92)
> bear-flip > time-stop (>365 days)."
```

---

## Task 4: `portfolio.mjs` — state management — TDD

**Files:**
- Create: `scripts/lib/portfolio.mjs`
- Create: `tests/portfolio.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/portfolio.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { initState, buyShares, sellShares, computeEquity, freeSlots } from '../scripts/lib/portfolio.mjs';

describe('initState', () => {
  it('initializes per-market cash + empty positions', () => {
    const s = initState({ krInitial: 10_000_000, usInitial: 10_000, maxSlots: 5 });
    expect(s.kr.cash).toBe(10_000_000);
    expect(s.us.cash).toBe(10_000);
    expect(s.kr.positions).toEqual([]);
    expect(s.us.positions).toEqual([]);
    expect(s.maxSlots).toBe(5);
  });
});

describe('buyShares', () => {
  it('creates new position when ticker absent', () => {
    const s = initState({ krInitial: 1_000_000, usInitial: 0, maxSlots: 5 });
    const next = buyShares(s, { market: 'KR', ticker: '005930.KS', name: 'A', shares: 10, price: 50000, date: '2024-01-02' });
    expect(next.kr.cash).toBe(500_000);
    expect(next.kr.positions).toHaveLength(1);
    expect(next.kr.positions[0]).toMatchObject({
      ticker: '005930.KS',
      shares: 10,
      costBasis: 500_000,
      avgCost: 50_000,
      peak: 50_000,
      firstBuyDate: '2024-01-02',
    });
  });
  it('averages cost on second buy of same ticker', () => {
    let s = initState({ krInitial: 1_000_000, usInitial: 0, maxSlots: 5 });
    s = buyShares(s, { market: 'KR', ticker: 'X', name: 'X', shares: 10, price: 100, date: '2024-01-02' });
    s = buyShares(s, { market: 'KR', ticker: 'X', name: 'X', shares: 10, price: 80, date: '2024-01-09' });
    const p = s.kr.positions[0];
    expect(p.shares).toBe(20);
    expect(p.costBasis).toBe(1800);
    expect(p.avgCost).toBe(90);
    expect(p.firstBuyDate).toBe('2024-01-02');
    expect(p.lastBuyDate).toBe('2024-01-09');
  });
});

describe('sellShares', () => {
  it('reduces shares + cash gain at sale price', () => {
    let s = initState({ krInitial: 1_000_000, usInitial: 0, maxSlots: 5 });
    s = buyShares(s, { market: 'KR', ticker: 'X', name: 'X', shares: 10, price: 100, date: '2024-01-02' });
    s = sellShares(s, { market: 'KR', ticker: 'X', shares: 5, price: 150, date: '2024-02-01' });
    const p = s.kr.positions[0];
    expect(p.shares).toBe(5);
    expect(s.kr.cash).toBe(1_000_000 - 1000 + 750);
  });
  it('removes position when shares reach 0', () => {
    let s = initState({ krInitial: 1_000_000, usInitial: 0, maxSlots: 5 });
    s = buyShares(s, { market: 'KR', ticker: 'X', name: 'X', shares: 10, price: 100, date: '2024-01-02' });
    s = sellShares(s, { market: 'KR', ticker: 'X', shares: 10, price: 150, date: '2024-02-01' });
    expect(s.kr.positions).toHaveLength(0);
  });
});

describe('computeEquity', () => {
  it('cash + sum(positions × current price) per market, FX-bridged total', () => {
    let s = initState({ krInitial: 1_000_000, usInitial: 1000, maxSlots: 5 });
    s = buyShares(s, { market: 'KR', ticker: 'A', name: 'A', shares: 10, price: 50_000, date: '2024-01-02' });
    s = buyShares(s, { market: 'US', ticker: 'B', name: 'B', shares: 4, price: 100, date: '2024-01-02' });
    const eq = computeEquity(s, { 'A': 55_000, 'B': 120 }, { usdKrw: 1300 });
    expect(eq.kr.cash).toBe(500_000);
    expect(eq.kr.posValue).toBe(550_000);
    expect(eq.us.cash).toBe(600);
    expect(eq.us.posValue).toBe(480);
    expect(eq.totalKrwEquiv).toBe(500_000 + 550_000 + (600 + 480) * 1300);
  });
});

describe('freeSlots', () => {
  it('returns slots - filled positions per market', () => {
    let s = initState({ krInitial: 1_000_000, usInitial: 1000, maxSlots: 5 });
    s = buyShares(s, { market: 'KR', ticker: 'A', name: 'A', shares: 1, price: 100, date: '2024-01-02' });
    s = buyShares(s, { market: 'KR', ticker: 'B', name: 'B', shares: 1, price: 100, date: '2024-01-02' });
    expect(freeSlots(s, 'KR')).toBe(3);
    expect(freeSlots(s, 'US')).toBe(5);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npx vitest run tests/portfolio.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

`scripts/lib/portfolio.mjs`:

```js
/**
 * Pure state-management helpers for the CWC portfolio simulator.
 * State shape:
 *   {
 *     kr: { cash:number, positions:Position[], blacklist:{ ticker:expiryDate } },
 *     us: { cash, positions, blacklist },
 *     maxSlots: number,
 *   }
 * Position:
 *   { ticker, market, name, shares, costBasis, avgCost, peak,
 *     firstBuyDate, lastBuyDate, dcaPlan|null, distPlan|null }
 */

export function initState({ krInitial, usInitial, maxSlots = 5 }) {
  return {
    kr: { cash: krInitial, positions: [], blacklist: {} },
    us: { cash: usInitial, positions: [], blacklist: {} },
    maxSlots,
  };
}

function clonePool(pool) {
  return {
    cash: pool.cash,
    positions: pool.positions.map((p) => ({ ...p })),
    blacklist: { ...pool.blacklist },
  };
}

function cloneState(state) {
  return { kr: clonePool(state.kr), us: clonePool(state.us), maxSlots: state.maxSlots };
}

function poolOf(state, market) {
  return market === 'KR' ? state.kr : state.us;
}

export function buyShares(state, { market, ticker, name, shares, price, date }) {
  const next = cloneState(state);
  const pool = poolOf(next, market);
  pool.cash -= shares * price;
  let pos = pool.positions.find((p) => p.ticker === ticker);
  if (!pos) {
    pos = {
      ticker, market, name,
      shares: 0, costBasis: 0, avgCost: 0, peak: price,
      firstBuyDate: date, lastBuyDate: date,
      dcaPlan: null, distPlan: null,
    };
    pool.positions.push(pos);
  }
  pos.shares += shares;
  pos.costBasis += shares * price;
  pos.avgCost = pos.costBasis / pos.shares;
  pos.peak = Math.max(pos.peak, price);
  pos.lastBuyDate = date;
  return next;
}

export function sellShares(state, { market, ticker, shares, price }) {
  const next = cloneState(state);
  const pool = poolOf(next, market);
  const pos = pool.positions.find((p) => p.ticker === ticker);
  if (!pos) return state;
  const sellShares_ = Math.min(shares, pos.shares);
  pool.cash += sellShares_ * price;
  pos.shares -= sellShares_;
  pos.costBasis -= sellShares_ * pos.avgCost;  // approximation: realize at avg
  if (pos.shares <= 0) {
    pool.positions = pool.positions.filter((p) => p.ticker !== ticker);
  }
  return next;
}

/**
 * priceMap: { ticker: lastClose } — must cover every open position; missing tickers use avgCost.
 * fx.usdKrw: USD→KRW rate for totalKrwEquiv.
 */
export function computeEquity(state, priceMap, fx = { usdKrw: 1300 }) {
  const krPosValue = state.kr.positions.reduce(
    (acc, p) => acc + (priceMap[p.ticker] ?? p.avgCost) * p.shares,
    0,
  );
  const usPosValue = state.us.positions.reduce(
    (acc, p) => acc + (priceMap[p.ticker] ?? p.avgCost) * p.shares,
    0,
  );
  return {
    kr: { cash: state.kr.cash, posValue: krPosValue },
    us: { cash: state.us.cash, posValue: usPosValue },
    totalKrwEquiv:
      state.kr.cash + krPosValue + (state.us.cash + usPosValue) * fx.usdKrw,
  };
}

export function freeSlots(state, market) {
  const pool = poolOf(state, market);
  return Math.max(0, state.maxSlots - pool.positions.length);
}

export function updatePeak(state, market, ticker, price) {
  const next = cloneState(state);
  const pool = poolOf(next, market);
  const pos = pool.positions.find((p) => p.ticker === ticker);
  if (pos) pos.peak = Math.max(pos.peak, price);
  return next;
}

export function setPlan(state, market, ticker, planKey, planValue) {
  const next = cloneState(state);
  const pool = poolOf(next, market);
  const pos = pool.positions.find((p) => p.ticker === ticker);
  if (pos) pos[planKey] = planValue;
  return next;
}

export function blacklistTicker(state, market, ticker, expiryDate) {
  const next = cloneState(state);
  const pool = poolOf(next, market);
  pool.blacklist[ticker] = expiryDate;
  return next;
}

export function isBlacklisted(state, market, ticker, currentDate) {
  const pool = poolOf(state, market);
  const expiry = pool.blacklist[ticker];
  if (!expiry) return false;
  if (expiry < currentDate) {
    delete pool.blacklist[ticker];
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run tests/portfolio.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/portfolio.mjs tests/portfolio.test.mjs
git commit -m "feat(portfolio): pure state init/buy/sell/equity helpers

Per-market cash + positions + blacklist. buyShares averages cost
on accumulation, sellShares realizes at avg (approximation),
computeEquity bridges USD via fixed FX. freeSlots/updatePeak/
setPlan/blacklistTicker round out the mutator surface."
```

---

## Task 5: `backtest-engine.mjs` — REWRITE — portfolio sim driver

**Files:**
- Modify: `scripts/lib/backtest-engine.mjs` (full rewrite)
- Modify: `tests/backtest-engine.test.mjs` (full rewrite)

- [ ] **Step 1: Replace test file with new spec**

Delete current `tests/backtest-engine.test.mjs` contents. Write new:

```js
import { describe, it, expect } from 'vitest';
import { simulate } from '../scripts/lib/backtest-engine.mjs';

function buildSyntheticTicker({ ticker, name, market, startDate, n, closeFn }) {
  const dates = [];
  const closes = [];
  const d = new Date(startDate + 'T00:00:00Z');
  let i = 0;
  while (dates.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
      closes.push(closeFn(i));
      i++;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { ticker, name, market, dates, closes, volumes: closes.map(() => 1000), highs: closes, lows: closes };
}

describe('simulate (portfolio)', () => {
  it('returns equityCurve covering every sim day and ledger array', () => {
    const t = buildSyntheticTicker({
      ticker: 'A', name: 'A', market: 'KR', startDate: '2023-01-02', n: 250,
      closeFn: (i) => 100 + Math.sin(i / 5) * 2,
    });
    const result = simulate({
      tickers: [t],
      simStart: '2023-01-02', simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      initialCapital: { krInitial: 1_000_000, usInitial: 0 },
      indexByMarket: {},
      bearByMarket: {},
    });
    expect(result.equityCurve).toBeInstanceOf(Array);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.ledger).toBeInstanceOf(Array);
    expect(result.positions).toBeInstanceOf(Array);
  });

  it('opens a position via DCA when cheap signal appears', () => {
    // 200 rising days then plunge → final RSI<35, distance from MA200 < 10%
    const rising = Array.from({ length: 200 }, (_, i) => 100 + i * 0.1);
    const drop = [115, 114, 113, 110, 108, 105, 103, 102, 101, 100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90];
    const closes = [...rising, ...drop];
    const t = buildSyntheticTicker({
      ticker: 'A', name: 'A', market: 'KR', startDate: '2023-01-02',
      n: closes.length, closeFn: (i) => closes[i],
    });
    const result = simulate({
      tickers: [t],
      simStart: '2023-01-02', simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      initialCapital: { krInitial: 1_000_000, usInitial: 0 },
      indexByMarket: {},
      bearByMarket: {},
    });
    const buys = result.ledger.filter((l) => l.action === 'buy' && l.ticker === 'A');
    expect(buys.length).toBeGreaterThan(0);
  });

  it('catastrophe gate fires when close drops 10% below avgCost', () => {
    // Cheap → buy → -15% plunge
    const rising = Array.from({ length: 200 }, (_, i) => 100 + i * 0.1);
    const drop = [115, 113, 110, 105, 100, 95, 90, 85, 80, 75];
    const closes = [...rising, ...drop];
    const t = buildSyntheticTicker({
      ticker: 'A', name: 'A', market: 'KR', startDate: '2023-01-02',
      n: closes.length, closeFn: (i) => closes[i],
    });
    const result = simulate({
      tickers: [t],
      simStart: '2023-01-02', simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      initialCapital: { krInitial: 1_000_000, usInitial: 0 },
      indexByMarket: {},
      bearByMarket: {},
    });
    const catastropheSells = result.ledger.filter(
      (l) => l.action === 'sell' && l.reason === 'catastrophe',
    );
    expect(catastropheSells.length).toBeGreaterThan(0);
  });

  it('bear-flip gate liquidates positions when regime turns bear', () => {
    const rising = Array.from({ length: 200 }, (_, i) => 100 + i * 0.1);
    const drop = [115, 114, 113, 110, 108, 105, 103, 102, 101, 100, 99];
    const closes = [...rising, ...drop, ...Array(50).fill(100)];
    const t = buildSyntheticTicker({
      ticker: 'A', name: 'A', market: 'KR', startDate: '2023-01-02',
      n: closes.length, closeFn: (i) => closes[i],
    });
    const bearByMarket = { KR: Object.fromEntries(t.dates.map((d, i) => [d, i > 220])) };
    const result = simulate({
      tickers: [t],
      simStart: '2023-01-02', simEnd: t.dates[t.dates.length - 1],
      today: t.dates[t.dates.length - 1],
      initialCapital: { krInitial: 1_000_000, usInitial: 0 },
      indexByMarket: {},
      bearByMarket,
    });
    const bearSells = result.ledger.filter((l) => l.action === 'sell' && l.reason === 'bear-flip');
    expect(bearSells.length).toBeGreaterThan(0);
  });

  it('respects maxSlots cap (only opens up to 5 positions per market)', () => {
    // 6 tickers, all hit cheap signal on day 220
    const mkClose = (offset) => (i) => {
      const base = 100 + offset;
      if (i < 200) return base + i * 0.1;
      return base + 20 - (i - 200) * 1.5;
    };
    const tickers = Array.from({ length: 6 }, (_, k) =>
      buildSyntheticTicker({
        ticker: `T${k}`, name: `T${k}`, market: 'KR', startDate: '2023-01-02',
        n: 220, closeFn: mkClose(k),
      }),
    );
    const result = simulate({
      tickers,
      simStart: '2023-01-02', simEnd: tickers[0].dates[219],
      today: tickers[0].dates[219],
      initialCapital: { krInitial: 10_000_000, usInitial: 0 },
      indexByMarket: {},
      bearByMarket: {},
    });
    const openPositions = new Set(
      result.ledger.filter((l) => l.action === 'buy').map((l) => l.ticker),
    );
    expect(openPositions.size).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Replace engine with new portfolio sim**

Replace entire contents of `scripts/lib/backtest-engine.mjs`:

```js
import { valuationTag } from './valuation.mjs';
import { createDcaPlan, createDistPlan, chunkDueOn, abortIfSignalChanged } from './dca-plan.mjs';
import { evaluateExit } from './exit-rules.mjs';
import {
  initState, buyShares, sellShares, computeEquity, freeSlots,
  updatePeak, setPlan, blacklistTicker, isBlacklisted,
} from './portfolio.mjs';
import { scorePicks } from './scoring.mjs';

const FX_USD_KRW = 1300;
const MAX_SLOTS = 5;
const MIN_POSITION_FRACTION = 0.05;
const BLACKLIST_DAYS = 30;

function addCalendarDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function buildSimDates(tickers, simStart, simEnd) {
  const set = new Set();
  for (const t of tickers) for (const d of t.dates) if (d >= simStart && d <= simEnd) set.add(d);
  return [...set].sort();
}

function priceMapAt(tickers, date) {
  const map = {};
  for (const t of tickers) {
    const idx = t.dates.indexOf(date);
    if (idx >= 0) map[t.ticker] = t.closes[idx];
    else {
      // last available close on or before date
      let last = null;
      for (let k = t.dates.length - 1; k >= 0; k--) {
        if (t.dates[k] <= date) { last = t.closes[k]; break; }
      }
      if (last != null) map[t.ticker] = last;
    }
  }
  return map;
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86_400_000);
}

function convictionMultiplier(slice, distancePctBelowMa) {
  let mult = 1.0;
  try {
    const s = scorePicks(slice);
    if (s.passes.trendUp && s.passes.volumeUp && s.passes.accumulation) mult *= 1.5;
  } catch { /* not enough data */ }
  if (distancePctBelowMa > 0.05) mult *= 1.3;
  return Math.max(0.7, Math.min(1.5, mult));
}

function vol20(closes) {
  if (closes.length < 21) return 0.2;
  const rets = [];
  for (let i = closes.length - 20; i < closes.length; i++) {
    if (i <= 0) continue;
    rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * Run the CWC portfolio simulation.
 * Inputs:
 *   tickers[]      { ticker, name, market, dates[], closes[], volumes[], highs[], lows[] }
 *   simStart, simEnd, today
 *   initialCapital { krInitial, usInitial }
 *   indexByMarket  { KR: {dates,closes}, US: {dates,closes} } (currently unused but reserved for RS)
 *   bearByMarket   { KR: {date→bool}, US: {date→bool} }
 * Returns { equityCurve[], ledger[], positions[], metrics }
 */
export function simulate({
  tickers, simStart, simEnd, today,
  initialCapital, indexByMarket = {}, bearByMarket = {},
}) {
  let state = initState({
    krInitial: initialCapital.krInitial,
    usInitial: initialCapital.usInitial,
    maxSlots: MAX_SLOTS,
  });
  const ledger = [];
  const equityCurve = [];
  const tickersByKey = new Map(tickers.map((t) => [t.ticker, t]));
  const simDates = buildSimDates(tickers, simStart, simEnd);

  for (const D of simDates) {
    if (D > today) break;
    const prices = priceMapAt(tickers, D);

    // 1. Update peaks for all open positions
    for (const market of ['KR', 'US']) {
      const pool = market === 'KR' ? state.kr : state.us;
      for (const p of pool.positions) {
        const px = prices[p.ticker];
        if (px != null) state = updatePeak(state, market, p.ticker, px);
      }
    }

    // 2. Risk gates — evaluate every open position
    for (const market of ['KR', 'US']) {
      const isBear = bearByMarket[market]?.[D] === true;
      const pool = market === 'KR' ? state.kr : state.us;
      const positionsSnapshot = [...pool.positions];
      for (const p of positionsSnapshot) {
        const px = prices[p.ticker];
        if (px == null) continue;
        const holdingDays = daysBetween(p.firstBuyDate, D);
        const verdict = evaluateExit({
          close: px, avgCost: p.avgCost, peak: p.peak,
          isBear, holdingDays,
        });
        if (!verdict.fire) continue;
        const sharesSold = p.shares;
        state = sellShares(state, { market, ticker: p.ticker, shares: sharesSold, price: px });
        ledger.push({
          date: D, action: 'sell', market, ticker: p.ticker, name: p.name,
          shares: sharesSold, price: px, reason: verdict.reason,
          unrealizedReturn: (px - p.avgCost) / p.avgCost,
        });
        if (verdict.reason === 'catastrophe' || verdict.reason === 'trailing') {
          state = blacklistTicker(state, market, p.ticker, addCalendarDays(D, BLACKLIST_DAYS));
        }
      }
    }

    // 3. Distribution fills (active dist plans)
    for (const market of ['KR', 'US']) {
      const pool = market === 'KR' ? state.kr : state.us;
      for (const p of [...pool.positions]) {
        if (!p.distPlan) continue;
        const t = tickersByKey.get(p.ticker);
        if (!t) continue;
        const idx = t.dates.indexOf(D);
        if (idx < 0) continue;
        const tag = valuationTag(t.closes.slice(0, idx + 1));
        if (abortIfSignalChanged(p.distPlan, tag)) {
          state = setPlan(state, market, p.ticker, 'distPlan', null);
          continue;
        }
        const chunk = chunkDueOn(p.distPlan, D);
        if (!chunk) continue;
        const px = t.closes[idx];
        const sharesToSell = Math.min(chunk.shares, p.shares);
        if (sharesToSell <= 0) continue;
        state = sellShares(state, { market, ticker: p.ticker, shares: sharesToSell, price: px });
        chunk.filled = true;
        ledger.push({
          date: D, action: 'sell', market, ticker: p.ticker, name: p.name,
          shares: sharesToSell, price: px, reason: 'dist-chunk',
        });
      }
    }

    // 4. DCA fills (existing pending DCA plans + new entries)
    for (const market of ['KR', 'US']) {
      const pool = market === 'KR' ? state.kr : state.us;
      for (const p of [...pool.positions]) {
        if (!p.dcaPlan) continue;
        const t = tickersByKey.get(p.ticker);
        if (!t) continue;
        const idx = t.dates.indexOf(D);
        if (idx < 0) continue;
        const tag = valuationTag(t.closes.slice(0, idx + 1));
        if (abortIfSignalChanged(p.dcaPlan, tag)) {
          state = setPlan(state, market, p.ticker, 'dcaPlan', null);
          continue;
        }
        const chunk = chunkDueOn(p.dcaPlan, D);
        if (!chunk) continue;
        const px = t.closes[idx];
        const cost = chunk.shares * px;
        if (pool.cash < cost) continue;
        state = buyShares(state, { market, ticker: p.ticker, name: p.name, shares: chunk.shares, price: px, date: D });
        chunk.filled = true;
        ledger.push({
          date: D, action: 'buy', market, ticker: p.ticker, name: p.name,
          shares: chunk.shares, price: px, reason: 'dca-chunk',
        });
      }
    }

    // 5. New entries — scan watchlist for CHEAP signals
    for (const t of tickers) {
      const market = t.market;
      if (bearByMarket[market]?.[D] === true) continue;
      const idx = t.dates.indexOf(D);
      if (idx < 0) continue;
      if (idx < 200) continue;
      const slice = t.closes.slice(0, idx + 1);
      const tag = valuationTag(slice);
      if (tag !== 'cheap') continue;
      if (isBlacklisted(state, market, t.ticker, D)) continue;
      const pool = market === 'KR' ? state.kr : state.us;
      if (pool.positions.some((p) => p.ticker === t.ticker)) continue;
      if (freeSlots(state, market) === 0) continue;

      const eq = computeEquity(state, prices, { usdKrw: FX_USD_KRW });
      const marketEquity = market === 'KR'
        ? eq.kr.cash + eq.kr.posValue
        : eq.us.cash + eq.us.posValue;
      const baseSize = marketEquity / MAX_SLOTS;
      const ma200 = slice.slice(-200).reduce((a, b) => a + b, 0) / 200;
      const price = t.closes[idx];
      const distancePctBelowMa = ma200 > price ? (ma200 - price) / ma200 : 0;
      const sliceForScoring = {
        closes: t.closes.slice(Math.max(0, idx - 29), idx + 1),
        volumes: t.volumes.slice(Math.max(0, idx - 29), idx + 1),
        highs: t.highs.slice(Math.max(0, idx - 29), idx + 1),
        lows: t.lows.slice(Math.max(0, idx - 29), idx + 1),
      };
      const conviction = convictionMultiplier(sliceForScoring, distancePctBelowMa);
      const v20 = vol20(slice);
      const volAdjust = v20 > 0.35 ? 0.7 : 1.0;
      const targetSize = baseSize * conviction * volAdjust;
      if (targetSize < marketEquity * MIN_POSITION_FRACTION) continue;
      const totalShares = Math.floor(targetSize / price);
      if (totalShares < 3) continue;

      const dcaPlan = createDcaPlan({ startDate: D, totalShares });
      const day1Chunk = dcaPlan.chunks[0];
      const day1Cost = day1Chunk.shares * price;
      if (pool.cash < day1Cost) continue;

      state = buyShares(state, { market, ticker: t.ticker, name: t.name, shares: day1Chunk.shares, price, date: D });
      day1Chunk.filled = true;
      state = setPlan(state, market, t.ticker, 'dcaPlan', dcaPlan);
      ledger.push({
        date: D, action: 'buy', market, ticker: t.ticker, name: t.name,
        shares: day1Chunk.shares, price, reason: 'dca-start',
        conviction, volAdjust,
      });
    }

    // 6. Check for rich signals on open positions — start dist plan
    for (const market of ['KR', 'US']) {
      const pool = market === 'KR' ? state.kr : state.us;
      for (const p of [...pool.positions]) {
        if (p.distPlan) continue;
        const t = tickersByKey.get(p.ticker);
        if (!t) continue;
        const idx = t.dates.indexOf(D);
        if (idx < 0) continue;
        const slice = t.closes.slice(0, idx + 1);
        const tag = valuationTag(slice);
        if (tag !== 'rich') continue;
        const px = t.closes[idx];
        const gain = (px - p.avgCost) / p.avgCost;
        if (gain < 0.10) continue;
        const plan = createDistPlan({ startDate: D, totalShares: p.shares });
        state = setPlan(state, market, p.ticker, 'distPlan', plan);
      }
    }

    // 7. Record equity curve point
    const eqPoint = computeEquity(state, prices, { usdKrw: FX_USD_KRW });
    equityCurve.push({
      date: D,
      total: eqPoint.totalKrwEquiv,
      krCash: eqPoint.kr.cash, krPos: eqPoint.kr.posValue,
      usCash: eqPoint.us.cash, usPos: eqPoint.us.posValue,
    });
  }

  // Final position snapshot
  const finalPrices = priceMapAt(tickers, simDates[simDates.length - 1] ?? today);
  const positions = [];
  for (const market of ['KR', 'US']) {
    const pool = market === 'KR' ? state.kr : state.us;
    for (const p of pool.positions) {
      const px = finalPrices[p.ticker] ?? p.avgCost;
      positions.push({
        market,
        ticker: p.ticker, name: p.name,
        shares: p.shares, avgCost: p.avgCost, peak: p.peak,
        currentPrice: px,
        unrealizedReturn: (px - p.avgCost) / p.avgCost,
        firstBuyDate: p.firstBuyDate, lastBuyDate: p.lastBuyDate,
        dcaPlan: p.dcaPlan, distPlan: p.distPlan,
      });
    }
  }

  return { equityCurve, ledger, positions, finalState: state };
}
```

- [ ] **Step 3: Run — expect pass**

Run: `npx vitest run tests/backtest-engine.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 4: Run full regression**

Run: `npm test`
Expected: All prior tests still pass. New count includes valuation + dca-plan + exit-rules + portfolio + backtest-engine.

If existing tests fail because they import VIX_EXIT etc., delete those tests — they're obsoleted by the rewrite. Specifically check `tests/history-store.test.mjs` (matured-only matured exit should still work because we don't change history-store this task) and confirm green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/backtest-engine.mjs tests/backtest-engine.test.mjs
git commit -m "feat(backtest): rewrite engine as portfolio simulator

simulate({ tickers, initialCapital, indexByMarket, bearByMarket })
drives a CWC portfolio per market. Each sim day: update peaks,
evaluate risk gates, fill due DCA/dist chunks, scan for new cheap
entries (3-chunk DCA), promote rich positions to dist plan. Returns
equityCurve + ledger + positions + finalState."
```

---

## Task 6: `backtest-aggregate.mjs` — CAGR / MDD / Sharpe — extend

**Files:**
- Modify: `scripts/lib/backtest-aggregate.mjs`
- Modify: `tests/backtest-aggregate.test.mjs`

- [ ] **Step 1: Replace test file**

Replace entire `tests/backtest-aggregate.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { portfolioMetrics, sellReasonBreakdown } from '../scripts/lib/backtest-aggregate.mjs';

describe('portfolioMetrics', () => {
  it('computes CAGR over a 1-year equity doubling', () => {
    const curve = [
      { date: '2024-01-02', total: 1_000_000 },
      { date: '2025-01-02', total: 2_000_000 },
    ];
    const m = portfolioMetrics(curve);
    expect(m.cagr).toBeCloseTo(1.0, 2);
  });
  it('computes max drawdown', () => {
    const curve = [
      { date: '2024-01-02', total: 1_000_000 },
      { date: '2024-02-02', total: 1_200_000 },
      { date: '2024-03-02', total: 900_000 },
      { date: '2024-04-02', total: 1_100_000 },
    ];
    const m = portfolioMetrics(curve);
    expect(m.maxDrawdown).toBeCloseTo(0.25, 2);
  });
  it('computes Sharpe (mean daily return / stdev * sqrt(252))', () => {
    const curve = Array.from({ length: 252 }, (_, i) => ({
      date: `2024-${String(Math.floor(i / 21) + 1).padStart(2, '0')}-02`,
      total: 1_000_000 * Math.pow(1.001, i),
    }));
    const m = portfolioMetrics(curve);
    expect(m.sharpe).toBeGreaterThan(0);
  });
  it('handles single-point curve gracefully', () => {
    const m = portfolioMetrics([{ date: '2024-01-02', total: 1_000_000 }]);
    expect(m.cagr).toBe(0);
    expect(m.maxDrawdown).toBe(0);
    expect(m.sharpe).toBe(0);
  });
});

describe('sellReasonBreakdown', () => {
  it('counts sells per reason', () => {
    const ledger = [
      { action: 'sell', reason: 'catastrophe' },
      { action: 'sell', reason: 'trailing' },
      { action: 'sell', reason: 'trailing' },
      { action: 'sell', reason: 'dist-chunk' },
      { action: 'buy', reason: 'dca-start' },
    ];
    const b = sellReasonBreakdown(ledger);
    expect(b).toEqual({ catastrophe: 1, trailing: 2, 'dist-chunk': 1 });
  });
});
```

- [ ] **Step 2: Replace aggregate module**

Replace entire `scripts/lib/backtest-aggregate.mjs`:

```js
/**
 * Aggregate the portfolio equity curve + ledger into headline metrics.
 */

export function portfolioMetrics(equityCurve) {
  if (!equityCurve || equityCurve.length < 2) {
    return { cagr: 0, maxDrawdown: 0, sharpe: 0, days: equityCurve?.length ?? 0 };
  }
  const start = equityCurve[0].total;
  const end = equityCurve[equityCurve.length - 1].total;
  const startDate = new Date(equityCurve[0].date + 'T00:00:00Z').getTime();
  const endDate = new Date(equityCurve[equityCurve.length - 1].date + 'T00:00:00Z').getTime();
  const years = Math.max((endDate - startDate) / (365.25 * 86_400_000), 1 / 365.25);
  const cagr = start > 0 ? Math.pow(end / start, 1 / years) - 1 : 0;

  // Max drawdown
  let peak = start;
  let maxDD = 0;
  for (const p of equityCurve) {
    if (p.total > peak) peak = p.total;
    const dd = (peak - p.total) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe — daily return stdev annualized
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].total;
    if (prev > 0) returns.push(equityCurve[i].total / prev - 1);
  }
  if (returns.length < 2) return { cagr, maxDrawdown: maxDD, sharpe: 0, days: equityCurve.length };
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const stdev = Math.sqrt(variance);
  const sharpe = stdev > 0 ? (mean / stdev) * Math.sqrt(252) : 0;

  return { cagr, maxDrawdown: maxDD, sharpe, days: equityCurve.length };
}

export function sellReasonBreakdown(ledger) {
  const out = {};
  for (const row of ledger) {
    if (row.action !== 'sell') continue;
    out[row.reason] = (out[row.reason] ?? 0) + 1;
  }
  return out;
}
```

- [ ] **Step 3: Run — expect pass**

Run: `npx vitest run tests/backtest-aggregate.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/backtest-aggregate.mjs tests/backtest-aggregate.test.mjs
git commit -m "feat(aggregate): portfolio CAGR / MDD / Sharpe / sell breakdown

Replaces per-pick bucketize with equity-curve-based metrics.
sellReasonBreakdown tallies the exit gate distribution."
```

---

## Task 7: `backtest.mjs` — single merged pool driver

**Files:**
- Modify: `scripts/backtest.mjs`

- [ ] **Step 1: Replace `scripts/backtest.mjs`**

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMany, fetchChart } from './fetch-yahoo.mjs';
import { simulate } from './lib/backtest-engine.mjs';
import { portfolioMetrics, sellReasonBreakdown } from './lib/backtest-aggregate.mjs';
import { buildBearMap } from './lib/regime-detect.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIM_START = '2022-01-01';
const INITIAL_KR = 10_000_000;
const INITIAL_US = 10_000;

function todayStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function loadJson(name) {
  return JSON.parse(readFileSync(resolve(__dirname, name), 'utf8'));
}

async function main() {
  const today = todayStr();
  console.log('[backtest] fetching ^GSPC, ^KS11 (5y)...');
  const [gspcData, ksData] = await Promise.all([
    fetchChart('^GSPC', '5y'),
    fetchChart('^KS11', '5y'),
  ]);
  if (!gspcData || !ksData) {
    console.error('[backtest] index fetch failed — aborting');
    process.exit(1);
  }
  const bearByMarket = {
    US: buildBearMap(gspcData.dates, gspcData.closes),
    KR: buildBearMap(ksData.dates, ksData.closes),
  };
  const indexByMarket = {
    US: { dates: gspcData.dates, closes: gspcData.closes },
    KR: { dates: ksData.dates, closes: ksData.closes },
  };

  // Merge stock + ETF universes into single per-market pool
  const krStock = loadJson('universe-kr.json');
  const krEtf = loadJson('universe-etf-kr.json');
  const usStock = loadJson('universe-us.json');
  const usEtf = loadJson('universe-etf-us.json');
  const kr = [...krStock, ...krEtf];
  const us = [...usStock, ...usEtf];

  console.log(`[backtest] fetching ${kr.length + us.length} tickers @ range=5y...`);
  const krFetched = await fetchMany(kr.map((t) => ({ ...t, market: 'KR' })), { range: '5y', delayMs: 200 });
  const usFetched = await fetchMany(us.map((t) => ({ ...t, market: 'US' })), { range: '5y', delayMs: 200 });

  const tickers = [...krFetched, ...usFetched]
    .filter((row) => row.data && row.data.dates && row.data.dates.length >= 200)
    .map((row) => ({
      ticker: row.ticker, name: row.name, market: row.market,
      dates: row.data.dates, closes: row.data.closes,
      volumes: row.data.volumes, highs: row.data.highs, lows: row.data.lows,
    }));
  console.log(`[backtest] usable tickers: ${tickers.length} (KR ${tickers.filter((t) => t.market === 'KR').length}, US ${tickers.filter((t) => t.market === 'US').length})`);

  console.log(`[backtest] simulating ${SIM_START} -> ${today}...`);
  const t0 = Date.now();
  const result = simulate({
    tickers,
    simStart: SIM_START, simEnd: today, today,
    initialCapital: { krInitial: INITIAL_KR, usInitial: INITIAL_US },
    indexByMarket, bearByMarket,
  });
  console.log(`[backtest] sim done in ${Date.now() - t0}ms, ledger=${result.ledger.length}, positions=${result.positions.length}, curve=${result.equityCurve.length}`);

  const metrics = portfolioMetrics(result.equityCurve);
  const sells = sellReasonBreakdown(result.ledger);
  console.log(`[backtest] CAGR=${(metrics.cagr * 100).toFixed(2)}% MDD=${(metrics.maxDrawdown * 100).toFixed(2)}% Sharpe=${metrics.sharpe.toFixed(2)}`);
  console.log('[backtest] sell reasons:', sells);

  const out = {
    asOf: new Date().toISOString(),
    window: { start: SIM_START, end: today },
    initialCapital: { krInitial: INITIAL_KR, usInitial: INITIAL_US },
    metrics,
    sellReasonBreakdown: sells,
    equityCurve: result.equityCurve,
    ledger: result.ledger,
    positions: result.positions,
  };
  const outputPath = resolve(__dirname, '../src/data/backtest.json');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[backtest] wrote ${outputPath}`);
}

main().catch((err) => {
  console.error('[backtest] failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Syntax check**

Run: `node --check scripts/backtest.mjs`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/backtest.mjs
git commit -m "feat(backtest): single merged pool per market

Stock + ETF universes merge into one KR pool + one US pool.
Drops two-track runBacktestTrack. Output schema now { metrics,
equityCurve, ledger, positions } — per-pick bucket aggregation
gone."
```

---

## Task 8: UI components — EquityCurve + PositionRow

**Files:**
- Create: `src/components/EquityCurve.astro`
- Create: `src/components/PositionRow.astro`

- [ ] **Step 1: Write `EquityCurve.astro`**

```astro
---
const { points = [] } = Astro.props as { points: { date: string; total: number }[] };
const w = 600;
const h = 200;
let path = '';
let minY = Infinity, maxY = -Infinity;
for (const p of points) {
  if (p.total < minY) minY = p.total;
  if (p.total > maxY) maxY = p.total;
}
if (points.length > 0) {
  const span = Math.max(maxY - minY, 1);
  for (let i = 0; i < points.length; i++) {
    const x = (i / Math.max(points.length - 1, 1)) * w;
    const y = h - ((points[i].total - minY) / span) * h;
    path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
  }
}
const startEq = points[0]?.total ?? 0;
const endEq = points[points.length - 1]?.total ?? 0;
const totalReturn = startEq > 0 ? (endEq / startEq - 1) * 100 : 0;
---
<div class="rounded-lg border border-gray-200 p-4 bg-white">
  <div class="flex items-baseline justify-between mb-2">
    <h3 class="font-semibold">자산 곡선</h3>
    <div class="text-sm text-gray-600">
      {points[0]?.date} → {points[points.length - 1]?.date}
      <span class={totalReturn >= 0 ? 'text-red-600 ml-2' : 'text-blue-600 ml-2'}>
        {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%
      </span>
    </div>
  </div>
  <svg viewBox={`0 0 ${w} ${h}`} class="w-full h-48">
    <path d={path} fill="none" stroke="#2563eb" stroke-width="2" />
  </svg>
  <div class="grid grid-cols-2 gap-2 mt-2 text-sm">
    <div><span class="text-gray-500">시작:</span> {Math.round(startEq).toLocaleString()} 원</div>
    <div><span class="text-gray-500">현재:</span> {Math.round(endEq).toLocaleString()} 원</div>
  </div>
</div>
```

- [ ] **Step 2: Write `PositionRow.astro`**

```astro
---
const { position } = Astro.props;
const r = position.unrealizedReturn ?? 0;
const positive = r >= 0;
const colorCls = positive ? 'text-red-600' : 'text-blue-600';
---
<div class="border-b border-gray-100 py-2 flex items-center gap-4 text-sm">
  <div class="flex-1 min-w-0">
    <div class="font-medium truncate">{position.name}</div>
    <div class="text-gray-500 text-xs">{position.ticker} · {position.market}</div>
  </div>
  <div class="text-right">
    <div>{position.shares.toLocaleString()}주</div>
    <div class="text-gray-500 text-xs">평단 {Math.round(position.avgCost).toLocaleString()}</div>
  </div>
  <div class="text-right">
    <div>{Math.round(position.currentPrice).toLocaleString()}</div>
    <div class={`${colorCls} text-xs`}>{positive ? '+' : ''}{(r * 100).toFixed(1)}%</div>
  </div>
  <div class="text-right text-xs text-gray-500">
    {position.dcaPlan ? 'DCA 진행' : position.distPlan ? '분할 매도' : '보유'}
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/EquityCurve.astro src/components/PositionRow.astro
git commit -m "feat(ui): EquityCurve SVG chart + PositionRow

Two pure-presentation Astro components. EquityCurve renders the
equity curve as an inline SVG path. PositionRow shows a single
open position with shares, avg cost, current price, unrealized
return, and active plan badge."
```

---

## Task 9: `/portfolio` page

**Files:**
- Create: `src/pages/portfolio.astro`

- [ ] **Step 1: Write `portfolio.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import EquityCurve from '../components/EquityCurve.astro';
import PositionRow from '../components/PositionRow.astro';
import data from '../data/backtest.json';

const { metrics, sellReasonBreakdown, equityCurve, ledger, positions, initialCapital, window: win } = data;
const totalInitial = initialCapital.krInitial + initialCapital.usInitial * 1300;
const totalCurrent = equityCurve[equityCurve.length - 1]?.total ?? totalInitial;
const totalReturn = (totalCurrent / totalInitial - 1) * 100;
const recentLedger = [...ledger].slice(-20).reverse();
---
<Base title="surgePick — 포트폴리오">
  <main class="max-w-3xl mx-auto px-4 py-6 space-y-6">
    <h1 class="text-2xl font-bold">포트폴리오</h1>

    <div class="grid grid-cols-2 gap-3">
      <div class="rounded-lg border p-3 bg-white">
        <div class="text-xs text-gray-500">CAGR</div>
        <div class="text-xl font-bold">{(metrics.cagr * 100).toFixed(1)}%</div>
      </div>
      <div class="rounded-lg border p-3 bg-white">
        <div class="text-xs text-gray-500">MDD</div>
        <div class="text-xl font-bold text-blue-600">{(metrics.maxDrawdown * 100).toFixed(1)}%</div>
      </div>
      <div class="rounded-lg border p-3 bg-white">
        <div class="text-xs text-gray-500">Sharpe</div>
        <div class="text-xl font-bold">{metrics.sharpe.toFixed(2)}</div>
      </div>
      <div class="rounded-lg border p-3 bg-white">
        <div class="text-xs text-gray-500">총 수익</div>
        <div class={`text-xl font-bold ${totalReturn >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
          {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%
        </div>
      </div>
    </div>

    <EquityCurve points={equityCurve} />

    <section>
      <h2 class="font-semibold mb-2">현재 보유 ({positions.length})</h2>
      <div class="bg-white border rounded-lg overflow-hidden">
        {positions.length === 0 ? (
          <div class="p-4 text-gray-500 text-sm">보유 종목 없음</div>
        ) : positions.map((p) => <PositionRow position={p} />)}
      </div>
    </section>

    <section>
      <h2 class="font-semibold mb-2">청산 사유 분포</h2>
      <div class="bg-white border rounded-lg p-3 text-sm grid grid-cols-2 gap-2">
        {Object.entries(sellReasonBreakdown).map(([reason, n]) => (
          <div class="flex justify-between"><span>{reason}</span><span class="font-medium">{n}</span></div>
        ))}
      </div>
    </section>

    <section>
      <h2 class="font-semibold mb-2">최근 거래 (20)</h2>
      <div class="bg-white border rounded-lg overflow-hidden text-sm">
        {recentLedger.map((l) => (
          <div class="border-b border-gray-100 py-2 px-3 flex items-center gap-3">
            <div class="text-xs text-gray-500 w-20">{l.date}</div>
            <div class={`text-xs font-medium w-10 ${l.action === 'buy' ? 'text-red-600' : 'text-blue-600'}`}>
              {l.action === 'buy' ? '매수' : '매도'}
            </div>
            <div class="flex-1 truncate">{l.name} <span class="text-gray-500 text-xs">{l.ticker}</span></div>
            <div class="text-right">{l.shares}주 @ {Math.round(l.price).toLocaleString()}</div>
            <div class="text-xs text-gray-500 w-20 text-right">{l.reason}</div>
          </div>
        ))}
      </div>
    </section>

    <div class="text-xs text-gray-400">백테스트 기간 {win.start} → {win.end}</div>
  </main>
</Base>
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: build succeeds. (Backtest.json may be old shape — placeholder for now until Task 13 regenerates.)

If build fails due to data shape mismatch, write a stub `src/data/backtest.json`:
```json
{
  "asOf": "2026-05-28T00:00:00.000Z",
  "window": { "start": "2022-01-01", "end": "2026-05-28" },
  "initialCapital": { "krInitial": 10000000, "usInitial": 10000 },
  "metrics": { "cagr": 0, "maxDrawdown": 0, "sharpe": 0, "days": 0 },
  "sellReasonBreakdown": {},
  "equityCurve": [],
  "ledger": [],
  "positions": []
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/portfolio.astro src/data/backtest.json
git commit -m "feat(ui): /portfolio page with equity curve + positions

Shows headline metrics (CAGR/MDD/Sharpe/total return), equity
curve chart, current holdings list, sell-reason breakdown, and
recent ledger. Backtest.json reshaped to portfolio output schema."
```

---

## Task 10: `/watchlist` page

**Files:**
- Create: `src/pages/watchlist.astro`

- [ ] **Step 1: Stub `src/data/watchlist.json`**

Create file (Task 12 will fill it via scan):

```json
{
  "asOf": "2026-05-28T00:00:00.000Z",
  "cheap": [],
  "neutral": [],
  "rich": []
}
```

- [ ] **Step 2: Write `watchlist.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import data from '../data/watchlist.json';

const sections = [
  { key: 'cheap', label: '🟢 싸다', color: 'green' },
  { key: 'neutral', label: '⚪ 보통', color: 'gray' },
  { key: 'rich', label: '🔴 비싸다', color: 'red' },
];
---
<Base title="surgePick — Watchlist">
  <main class="max-w-3xl mx-auto px-4 py-6 space-y-6">
    <h1 class="text-2xl font-bold">관찰목록</h1>
    <p class="text-sm text-gray-600">200일 이동평균 위 / 지수 대비 강한 종목 중 오늘의 가격대.</p>

    {sections.map((sec) => {
      const items = data[sec.key] ?? [];
      return (
        <section>
          <h2 class="font-semibold mb-2">{sec.label} ({items.length})</h2>
          <div class="bg-white border rounded-lg overflow-hidden">
            {items.length === 0 ? (
              <div class="p-4 text-gray-500 text-sm">없음</div>
            ) : items.map((row) => (
              <div class="border-b border-gray-100 py-2 px-3 flex items-center gap-3 text-sm">
                <div class="flex-1 min-w-0">
                  <div class="font-medium truncate">{row.name}</div>
                  <div class="text-xs text-gray-500">{row.ticker} · {row.market}</div>
                </div>
                <div class="text-right">
                  <div>{row.price?.toLocaleString?.() ?? row.price}</div>
                  <div class="text-xs text-gray-500">RSI {row.rsi?.toFixed?.(0)}</div>
                </div>
                <div class="text-right text-xs text-gray-500">
                  MA200 {row.ma200Distance >= 0 ? '+' : ''}{(row.ma200Distance * 100).toFixed(1)}%
                </div>
                {row.inPortfolio && <div class="text-xs text-blue-600 font-medium">보유</div>}
              </div>
            ))}
          </div>
        </section>
      );
    })}

    <div class="text-xs text-gray-400">갱신 {data.asOf}</div>
  </main>
</Base>
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/watchlist.astro src/data/watchlist.json
git commit -m "feat(ui): /watchlist page (cheap / neutral / rich)

Three sections grouped by valuation tag. Each row: ticker, name,
RSI, distance from MA200, in-portfolio flag. Empty data stub —
filled by Task 12 scanner."
```

---

## Task 11: `/stats` + `/index.astro` updates

**Files:**
- Modify: `src/pages/stats.astro`
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Read existing index.astro and stats.astro**

Read both files to understand current shape. We need to:
- `stats.astro`: replace per-pick bucket UI with metrics + sell breakdown summary, link to /portfolio for details.
- `index.astro`: add nav links to /portfolio and /watchlist; replace today-picks card with today-actions (latest ledger entries).

- [ ] **Step 2: Rewrite `src/pages/stats.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import data from '../data/backtest.json';

const { metrics, sellReasonBreakdown, window: win } = data;
const totalCurrent = data.equityCurve[data.equityCurve.length - 1]?.total ?? 0;
const totalInitial = data.initialCapital.krInitial + data.initialCapital.usInitial * 1300;
const totalReturn = totalInitial > 0 ? (totalCurrent / totalInitial - 1) * 100 : 0;
const breakdown = Object.entries(sellReasonBreakdown ?? {}).sort((a, b) => b[1] - a[1]);
---
<Base title="surgePick — 백테스트">
  <main class="max-w-3xl mx-auto px-4 py-6 space-y-6">
    <h1 class="text-2xl font-bold">백테스트 결과</h1>
    <p class="text-sm text-gray-600">{win.start} → {win.end} · 초기 1000만원 + $10K</p>

    <div class="grid grid-cols-2 gap-3">
      <div class="rounded-lg border p-3 bg-white">
        <div class="text-xs text-gray-500">CAGR</div>
        <div class="text-2xl font-bold">{(metrics.cagr * 100).toFixed(1)}%</div>
      </div>
      <div class="rounded-lg border p-3 bg-white">
        <div class="text-xs text-gray-500">최대 낙폭</div>
        <div class="text-2xl font-bold text-blue-600">{(metrics.maxDrawdown * 100).toFixed(1)}%</div>
      </div>
      <div class="rounded-lg border p-3 bg-white">
        <div class="text-xs text-gray-500">Sharpe</div>
        <div class="text-2xl font-bold">{metrics.sharpe.toFixed(2)}</div>
      </div>
      <div class="rounded-lg border p-3 bg-white">
        <div class="text-xs text-gray-500">총 수익</div>
        <div class={`text-2xl font-bold ${totalReturn >= 0 ? 'text-red-600' : 'text-blue-600'}`}>
          {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%
        </div>
      </div>
    </div>

    <section>
      <h2 class="font-semibold mb-2">청산 사유 분포</h2>
      <div class="bg-white border rounded-lg p-3 text-sm space-y-1">
        {breakdown.map(([reason, n]) => (
          <div class="flex justify-between"><span>{reason}</span><span class="font-medium">{n}</span></div>
        ))}
      </div>
    </section>

    <a href="/portfolio" class="block bg-blue-50 border border-blue-200 rounded-lg p-3 text-center font-medium text-blue-700">
      📊 자세히 보기 — 자산 곡선 + 보유 종목
    </a>
  </main>
</Base>
```

- [ ] **Step 3: Update `src/pages/index.astro`**

Open existing file. Find nav / footer section. Add links to /portfolio and /watchlist. The exact diff depends on current state — perform this surgical insertion:

Locate any existing `<nav>` or footer bar. Add adjacent to existing /stats link:

```astro
<a href="/portfolio" class="...">포트폴리오</a>
<a href="/watchlist" class="...">관찰목록</a>
```

If no nav exists, append a nav bar at the top of the `<main>`:

```astro
<nav class="flex gap-3 text-sm py-2 px-4 border-b">
  <a href="/" class="font-medium">홈</a>
  <a href="/portfolio">포트폴리오</a>
  <a href="/watchlist">관찰목록</a>
  <a href="/stats">통계</a>
  <a href="/history">기록</a>
</nav>
```

Also: if index.astro renders today picks from `picks.json`, add a graceful fallback when picks.json is empty or the shape doesn't match anymore (CWC will repurpose picks.json to "today's actions" in Task 12). For Task 11, just ensure index.astro builds without crash — wrap any direct picks.json reads in `data?.picks ?? []` style guards.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/stats.astro src/pages/index.astro
git commit -m "feat(ui): /stats CAGR/MDD/Sharpe + index nav links

Replaces per-pick bucket tables with portfolio metrics overview.
Index gets nav links to /portfolio + /watchlist."
```

---

## Task 12: `scan-picks.mjs` — state-advancing scanner

**Files:**
- Modify: `scripts/scan-picks.mjs`

- [ ] **Step 1: Rewrite scan-picks.mjs**

```js
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMany, fetchChart } from './fetch-yahoo.mjs';
import { simulate } from './lib/backtest-engine.mjs';
import { buildBearMap } from './lib/regime-detect.mjs';
import { valuationTag, rsi, sma } from './lib/valuation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INITIAL_KR = 10_000_000;
const INITIAL_US = 10_000;
const PORTFOLIO_PATH = resolve(__dirname, '../src/data/portfolio.json');
const WATCHLIST_PATH = resolve(__dirname, '../src/data/watchlist.json');
const PICKS_PATH = resolve(__dirname, '../src/data/picks.json');
const BACKTEST_PATH = resolve(__dirname, '../src/data/backtest.json');

function todayStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function loadJson(name) {
  return JSON.parse(readFileSync(resolve(__dirname, name), 'utf8'));
}

function loadPortfolio() {
  if (!existsSync(PORTFOLIO_PATH)) {
    return {
      lastUpdateDate: null,
      initialCapital: { krInitial: INITIAL_KR, usInitial: INITIAL_US },
      // First-run sentinel: simulate will seed from backtest if available.
    };
  }
  return JSON.parse(readFileSync(PORTFOLIO_PATH, 'utf8'));
}

async function main() {
  const today = todayStr();
  console.log(`[scan-picks] today=${today}`);

  console.log('[scan-picks] fetching indices...');
  const [gspc, ks] = await Promise.all([
    fetchChart('^GSPC', '1y'),
    fetchChart('^KS11', '1y'),
  ]);
  const bearByMarket = {
    US: gspc ? buildBearMap(gspc.dates, gspc.closes) : {},
    KR: ks ? buildBearMap(ks.dates, ks.closes) : {},
  };

  const krStock = loadJson('universe-kr.json');
  const krEtf = loadJson('universe-etf-kr.json');
  const usStock = loadJson('universe-us.json');
  const usEtf = loadJson('universe-etf-us.json');
  const universe = [
    ...krStock.map((t) => ({ ...t, market: 'KR' })),
    ...krEtf.map((t) => ({ ...t, market: 'KR' })),
    ...usStock.map((t) => ({ ...t, market: 'US' })),
    ...usEtf.map((t) => ({ ...t, market: 'US' })),
  ];

  console.log(`[scan-picks] fetching ${universe.length} tickers @ range=1y...`);
  const fetched = await fetchMany(universe, { range: '1y', delayMs: 200 });
  const tickers = fetched
    .filter((row) => row.data && row.data.dates && row.data.dates.length >= 200)
    .map((row) => ({
      ticker: row.ticker, name: row.name, market: row.market,
      dates: row.data.dates, closes: row.data.closes,
      volumes: row.data.volumes, highs: row.data.highs, lows: row.data.lows,
    }));

  // Build watchlist (today's tags)
  const watchlist = { cheap: [], neutral: [], rich: [] };
  for (const t of tickers) {
    const tag = valuationTag(t.closes);
    const endIdx = t.closes.length - 1;
    const ma200 = sma(t.closes, endIdx, 200);
    const rsiVal = rsi(t.closes, 14);
    const price = t.closes[endIdx];
    const row = {
      ticker: t.ticker, name: t.name, market: t.market,
      price,
      rsi: Number.isNaN(rsiVal) ? null : rsiVal,
      ma200Distance: Number.isNaN(ma200) ? null : (price - ma200) / ma200,
      inPortfolio: false,
    };
    watchlist[tag].push(row);
  }
  watchlist.cheap.sort((a, b) => (a.ma200Distance ?? 0) - (b.ma200Distance ?? 0));
  watchlist.rich.sort((a, b) => (b.ma200Distance ?? 0) - (a.ma200Distance ?? 0));
  watchlist.asOf = new Date().toISOString();

  // Re-simulate to advance state (idempotent: re-run today gives same result)
  console.log('[scan-picks] running portfolio sim...');
  const portfolio = loadPortfolio();
  const SIM_START = '2022-01-01';
  // Fetch 5y series for the sim (idempotent; live picks happen on the very last bar)
  console.log('[scan-picks] fetching 5y series for sim...');
  const fetched5y = await fetchMany(universe, { range: '5y', delayMs: 200 });
  const fullTickers = fetched5y
    .filter((row) => row.data && row.data.dates && row.data.dates.length >= 200)
    .map((row) => ({
      ticker: row.ticker, name: row.name, market: row.market,
      dates: row.data.dates, closes: row.data.closes,
      volumes: row.data.volumes, highs: row.data.highs, lows: row.data.lows,
    }));
  const [gspc5, ks5] = await Promise.all([
    fetchChart('^GSPC', '5y'),
    fetchChart('^KS11', '5y'),
  ]);
  const bearByMarket5 = {
    US: gspc5 ? buildBearMap(gspc5.dates, gspc5.closes) : {},
    KR: ks5 ? buildBearMap(ks5.dates, ks5.closes) : {},
  };

  const result = simulate({
    tickers: fullTickers,
    simStart: SIM_START, simEnd: today, today,
    initialCapital: portfolio.initialCapital ?? { krInitial: INITIAL_KR, usInitial: INITIAL_US },
    indexByMarket: {},
    bearByMarket: bearByMarket5,
  });

  // Mark in-portfolio tickers in watchlist
  const heldTickers = new Set(result.positions.map((p) => p.ticker));
  for (const sec of ['cheap', 'neutral', 'rich']) {
    for (const row of watchlist[sec]) row.inPortfolio = heldTickers.has(row.ticker);
  }

  // Today's actions (ledger entries on `today`)
  const todayActions = result.ledger.filter((l) => l.date === today);

  // Write outputs
  mkdirSync(dirname(PORTFOLIO_PATH), { recursive: true });
  writeFileSync(PORTFOLIO_PATH, JSON.stringify({
    asOf: new Date().toISOString(),
    lastUpdateDate: today,
    initialCapital: portfolio.initialCapital ?? { krInitial: INITIAL_KR, usInitial: INITIAL_US },
    positions: result.positions,
  }, null, 2) + '\n', 'utf8');
  writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2) + '\n', 'utf8');
  writeFileSync(PICKS_PATH, JSON.stringify({
    asOf: new Date().toISOString(),
    today,
    actions: todayActions,
  }, null, 2) + '\n', 'utf8');

  console.log(`[scan-picks] watchlist cheap=${watchlist.cheap.length} neutral=${watchlist.neutral.length} rich=${watchlist.rich.length}`);
  console.log(`[scan-picks] portfolio positions=${result.positions.length}`);
  console.log(`[scan-picks] today actions=${todayActions.length}`);
}

main().catch((err) => {
  console.error('[scan-picks] failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Syntax check**

Run: `node --check scripts/scan-picks.mjs`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/scan-picks.mjs
git commit -m "feat(scan): state-advancing portfolio scanner

scan-picks now: (1) builds today's CHEAP/NEUTRAL/RICH watchlist,
(2) re-runs full 5y portfolio sim with today as simEnd
(idempotent — running again same day produces same result),
(3) writes portfolio.json + watchlist.json + picks.json (today's
ledger actions)."
```

---

## Task 13: Regenerate backtest data

- [ ] **Step 1: Delete obsolete files**

```bash
rm src/data/backtest-etf.json src/data/picks-etf.json src/data/picks-history.json src/data/picks-history-etf.json
```

- [ ] **Step 2: Run backtest**

Run: `npm run backtest` (timeout 900000ms)

Wait for completion. Capture:
- Bear days (US, KR)
- Usable tickers count
- Sim duration
- CAGR / MDD / Sharpe
- Sell reason breakdown

- [ ] **Step 3: Sanity check output**

Run inspector:

```bash
node -e "const d=require('./src/data/backtest.json'); console.log('curve len:', d.equityCurve.length, 'ledger:', d.ledger.length, 'positions:', d.positions.length); console.log('metrics:', d.metrics); console.log('sells:', d.sellReasonBreakdown);"
```

Expected:
- `curve len` ≈ sim trading days (~1100)
- `ledger` > 50 buys+sells
- `metrics.cagr` between -0.2 and 0.5 (sanity range)
- `metrics.maxDrawdown` between 0 and 0.5

If `metrics.cagr` is wildly off (e.g., 5.0 = +500%), check for FX double-counting in `computeEquity`.

- [ ] **Step 4: Commit data**

```bash
git add src/data/backtest.json
git rm -f src/data/backtest-etf.json src/data/picks-etf.json src/data/picks-history.json src/data/picks-history-etf.json 2>/dev/null || true
git commit -m "data: regenerate backtest as portfolio sim output

Single src/data/backtest.json now contains { metrics, equityCurve,
ledger, positions, sellReasonBreakdown }. Drops the per-pick
bucket schema and the separate ETF track output."
```

---

## Task 14: Live scan + push + verify

- [ ] **Step 1: Run scan**

Run: `npm run scan:picks` (timeout 900000ms)

Capture stdout: watchlist counts + position count.

- [ ] **Step 2: Commit live data**

```bash
git add src/data/portfolio.json src/data/watchlist.json src/data/picks.json
git commit -m "data: live scan output — portfolio + watchlist + today actions"
```

- [ ] **Step 3: Push + verify**

```bash
git pull --rebase && git push
```

Wait for Vercel deploy. Then visit:
- https://surge-pick.vercel.app/portfolio
- https://surge-pick.vercel.app/watchlist
- https://surge-pick.vercel.app/stats

Confirm:
- /portfolio: equity curve renders, current positions list shows, metrics headline correct
- /watchlist: cheap/neutral/rich sections present (counts > 0 in at least one)
- /stats: CAGR/MDD/Sharpe visible

- [ ] **Step 4: Sanity-check live result**

WebFetch `https://surge-pick.vercel.app/stats` — extract CAGR.

If CAGR < 0.05 (less than 5% annual), the strategy needs tuning. Capture findings in a follow-up note but do NOT modify the spec in this task — that's the next iteration's job.

---

## Self-Review

**Spec coverage check (cross-reference `2026-05-28-cwc-portfolio-design.md`):**

- [x] "Universe → Watchlist filter" — Tasks 1 (valuation), 12 (scan emits watchlist), 10 (UI)
- [x] "Conviction multiplier" — Task 5 engine `convictionMultiplier()`
- [x] "Position sizing" — Task 5 engine new-entry logic (`baseSize * conviction * volAdjust`)
- [x] "DCA buy plan" — Tasks 2 (lib), 5 (engine integrates DCA chunks)
- [x] "Distribution sell plan" — Tasks 2 (lib), 5 (engine integrates dist chunks)
- [x] "Risk gates" — Tasks 3 (lib), 5 (engine evaluates before any plan fill)
- [x] "Blacklist" — Task 4 (portfolio.blacklistTicker), Task 5 (engine sets on catastrophe/trailing)
- [x] "State machine" — Task 4
- [x] "Backtest engine rewrite" — Task 5
- [x] "Files mapping" — Tasks 1-12 cover every listed file
- [x] "Live (scan-picks)" — Task 12
- [x] "UI changes" — Tasks 8, 9, 10, 11
- [x] "Tests" — Tasks 1, 2, 3, 4, 5, 6 each have full TDD cycle

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in steps. Every step has full code or full command.

**Type consistency:**
- `Position` shape consistent across Task 4 (portfolio), Task 5 (engine), Task 9 (UI).
- `Plan` shape (kind, chunks[]) consistent across Task 2 (dca-plan), Task 5 (engine).
- `evaluateExit` signature `{ close, avgCost, peak, isBear, holdingDays }` consistent in Tasks 3, 5.
- `equityCurve` point shape `{ date, total, krCash, krPos, usCash, usPos }` consistent across Tasks 5, 6, 9.

**Scope check:** Single iteration, but large (14 tasks, ~5 hours). Could decompose into "v2a portfolio infrastructure (Tasks 1-7)" + "v2b live + UI (Tasks 8-14)". Decision: ship together since portfolio infra without UI is unverifiable and UI without portfolio is empty.

**Ambiguity check:**
- "still cheap" at chunk fill = re-evaluate `valuationTag` on current day's data, NOT plan-creation-day tag. Explicit in Task 5 step 2 DCA fills section.
- Risk gate priority is explicit in Task 3 implementation.
- FX rate constant (1300) explicitly stated in Task 5 and Task 4 default arg.

Plan ready.
