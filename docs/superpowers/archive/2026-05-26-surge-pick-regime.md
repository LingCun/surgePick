# surgePick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first Astro site with two big toggle buttons — `오늘의 급등픽` (KR/US top 3 each) and `지금 시장 어때?` (fear gauge + 4-market mood + recommended weight).

**Architecture:** Static Astro site. Two Node ESM scanner scripts (`scripts/scan-picks.mjs`, `scripts/scan-regime.mjs`) fetch daily OHLCV from Yahoo's public chart endpoint (no auth) and write JSON into `src/data/`. Astro renders that JSON into a single `index.astro` page. Client-side toggle script (small TS) reveals one section at a time. Deployed to Vercel.

**Tech Stack:** Astro 4, Tailwind CSS, TypeScript, Node 20 ESM, Vitest, Vercel.

**Reference codebase:** `C:/claude/lincoln-brief` uses the same `query1.finance.yahoo.com/v8/finance/chart/` pattern and is the source of the `fetchChartDirect` shape we reuse. Engineer may read `lincoln-brief/scripts/fetch-market.mjs` for the canonical Yahoo headers + retry pattern.

**Working directory:** `C:/claude/surgePick` (empty except `.claude/` and `docs/`).

**Spec:** `docs/superpowers/specs/2026-05-26-surge-pick-regime-design.md`

---

## File Map

```
surgePick/
├── package.json                          # Task 1
├── astro.config.mjs                      # Task 1
├── tailwind.config.mjs                   # Task 1
├── tsconfig.json                         # Task 1
├── vitest.config.mjs                     # Task 1
├── .gitignore                            # Task 1
├── README.md                             # Task 18
├── public/
│   └── robots.txt                        # Task 18
├── scripts/
│   ├── lib/
│   │   ├── stats.mjs                     # Task 2 — pure math
│   │   ├── scoring.mjs                   # Task 3 — picks 3-condition scorer
│   │   ├── regime.mjs                    # Task 4 — regime scorer
│   │   ├── fear-gauge.mjs                # Task 5 — VIX → 5-step mapping
│   │   ├── reason-template.mjs           # Task 6 — pick reason text
│   │   ├── market-comment.mjs            # Task 7 — regime comment text
│   │   ├── theme-aggregate.mjs           # Task 20 — compose theme index from constituents
│   │   └── theme-select.mjs              # Task 21 — daily pool → 8 popular + 8 value
│   ├── fetch-yahoo.mjs                   # Task 8 — Yahoo chart client
│   ├── universe-kr.json                  # Task 9 — KR ticker master
│   ├── universe-us.json                  # Task 9 — US ticker master
│   ├── themes-kr.json                    # Task 22 — KR theme master pool (30+ themes)
│   ├── themes-us.json                    # Task 22 — US theme master pool
│   ├── scan-picks.mjs                    # Task 10 — writes src/data/picks.json
│   ├── scan-regime.mjs                   # Task 11 — writes src/data/regime.json (incl. closes60/MA50/MA200)
│   └── scan-themes.mjs                   # Task 23 — writes src/data/themes.json
├── src/
│   ├── data/
│   │   ├── picks.json                    # Task 10 (generated)
│   │   ├── regime.json                   # Task 11 (generated)
│   │   └── themes.json                   # Task 23 (generated)
│   ├── layouts/
│   │   └── Base.astro                    # Task 12
│   ├── components/
│   │   ├── ActionButton.astro            # Task 13
│   │   ├── Sparkline.astro               # Task 14
│   │   ├── PickCard.astro                # Task 14
│   │   ├── IndexChart.astro              # Task 24 — 60d index + MA50/MA200 overlay
│   │   ├── FearGaugeCard.astro           # Task 15
│   │   ├── MarketMoodCard.astro          # Task 15 (uses IndexChart)
│   │   ├── OverallCard.astro             # Task 15
│   │   ├── ThemeCard.astro               # Task 25 — theme mini-chart card
│   │   ├── ThemeCarousel.astro           # Task 25 — scroll-snap carousel wrapper
│   │   └── ThemeTabs.astro               # Task 26 — 인기/투자가치 tab switcher
│   ├── scripts/
│   │   ├── toggle.ts                     # Task 16 — action button toggle
│   │   └── theme-tabs.ts                 # Task 26 — theme tab switcher
│   └── pages/
│       └── index.astro                   # Task 17 — single page (updated by Task 27)
└── tests/
    ├── stats.test.mjs                    # Task 2
    ├── scoring.test.mjs                  # Task 3
    ├── regime.test.mjs                   # Task 4
    ├── fear-gauge.test.mjs               # Task 5
    ├── reason-template.test.mjs          # Task 6
    ├── market-comment.test.mjs           # Task 7
    ├── theme-aggregate.test.mjs          # Task 20
    ├── theme-select.test.mjs             # Task 21
    └── fixtures/
        ├── uptrend-accumulation.json     # Task 3
        ├── spike-heavy.json              # Task 3
        ├── flat.json                     # Task 3
        ├── bull-index.json               # Task 4
        └── theme-basket.json             # Task 20
```

Each module is small and has one job. Tests sit next to no production code — the `.mjs` libs are pure functions consumed by both scanners and tests.

---

## Task 1: Scaffold Astro project

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tailwind.config.mjs`
- Create: `tsconfig.json`
- Create: `vitest.config.mjs`
- Create: `.gitignore`
- Create: `src/pages/index.astro` (temporary placeholder)

- [ ] **Step 1: Init git repo**

```bash
cd C:/claude/surgePick
git init
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "surge-pick",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": "20.x" },
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "scan:picks": "node scripts/scan-picks.mjs",
    "scan:regime": "node scripts/scan-regime.mjs",
    "scan": "npm run scan:regime && npm run scan:picks",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@astrojs/tailwind": "^5.1.4",
    "@astrojs/vercel": "^7.8.2",
    "astro": "^4.16.18",
    "tailwindcss": "^3.4.17"
  },
  "devDependencies": {
    "vitest": "^4.1.6"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` populated, no errors.

- [ ] **Step 4: Write `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel/static';

export default defineConfig({
  output: 'static',
  adapter: vercel(),
  integrations: [tailwind()],
  site: 'https://surgepick.vercel.app',
});
```

- [ ] **Step 5: Write `tailwind.config.mjs`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,ts,tsx,js,jsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          pick: '#2563eb',
          mood: '#f59e0b',
        },
        fear: {
          extremeGreed: '#dc2626',
          greed: '#f97316',
          neutral: '#facc15',
          fear: '#3b82f6',
          extremeFear: '#7c3aed',
        },
      },
      fontFamily: {
        sans: ['Pretendard', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 6: Write `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false
  }
}
```

- [ ] **Step 7: Write `vitest.config.mjs`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    environment: 'node',
  },
});
```

- [ ] **Step 8: Write `.gitignore`**

```
node_modules
dist
.astro
.vercel
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 9: Write placeholder `src/pages/index.astro`**

```astro
---
---
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>surgePick</title>
  </head>
  <body>
    <main class="p-8 text-center">
      <h1 class="text-2xl">surgePick — placeholder</h1>
    </main>
  </body>
</html>
```

- [ ] **Step 10: Verify build works**

```bash
npm run build
```

Expected: Astro build succeeds, outputs to `.vercel/output/static/index.html`.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json astro.config.mjs tailwind.config.mjs tsconfig.json vitest.config.mjs .gitignore src/pages/index.astro
git commit -m "chore: scaffold Astro + Tailwind + Vitest project"
```

---

## Task 2: Math utilities (`stats.mjs`) — TDD

**Files:**
- Create: `scripts/lib/stats.mjs`
- Create: `tests/stats.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/stats.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { mean, stdev, linearRegression, obv } from '../scripts/lib/stats.mjs';

describe('mean', () => {
  it('returns arithmetic mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
  it('handles single element', () => {
    expect(mean([5])).toBe(5);
  });
});

describe('stdev', () => {
  it('returns sample stdev', () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });
});

describe('linearRegression', () => {
  it('returns slope and intercept for perfect line', () => {
    const { slope, intercept } = linearRegression([1, 2, 3, 4, 5]);
    expect(slope).toBeCloseTo(1, 5);
    expect(intercept).toBeCloseTo(1, 5);
  });
  it('returns positive slope for ascending series', () => {
    const { slope } = linearRegression([10, 11, 12, 13, 14, 15]);
    expect(slope).toBeGreaterThan(0);
  });
  it('returns negative slope for descending series', () => {
    const { slope } = linearRegression([15, 14, 13, 12, 11, 10]);
    expect(slope).toBeLessThan(0);
  });
});

describe('obv', () => {
  it('accumulates volume by close direction', () => {
    const closes = [100, 101, 100, 102];
    const volumes = [1000, 2000, 1500, 3000];
    // day0=0, day1=+2000, day2=-1500, day3=+3000 → [0, 2000, 500, 3500]
    expect(obv(closes, volumes)).toEqual([0, 2000, 500, 3500]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- stats
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/lib/stats.mjs`**

```js
export function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const sq = arr.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(sq / (arr.length - 1));
}

export function linearRegression(ys) {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const xs = ys.map((_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

export function obv(closes, volumes) {
  const out = [0];
  for (let i = 1; i < closes.length; i++) {
    const prev = out[i - 1];
    if (closes[i] > closes[i - 1]) out.push(prev + volumes[i]);
    else if (closes[i] < closes[i - 1]) out.push(prev - volumes[i]);
    else out.push(prev);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- stats
```

Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/stats.mjs tests/stats.test.mjs
git commit -m "feat(stats): mean, stdev, linearRegression, obv with tests"
```

---

## Task 3: Picks scoring (`scoring.mjs`) — TDD

**Files:**
- Create: `scripts/lib/scoring.mjs`
- Create: `tests/scoring.test.mjs`
- Create: `tests/fixtures/uptrend-accumulation.json`
- Create: `tests/fixtures/spike-heavy.json`
- Create: `tests/fixtures/flat.json`

- [ ] **Step 1: Write fixtures**

`tests/fixtures/uptrend-accumulation.json` — synthetic 30-day series: gradual rise (~0.3%/day), volume increases (1× → 2×), price near lower-mid of range, OBV up:

```json
{
  "closes": [100,100.1,100.3,100.2,100.5,100.7,100.6,100.9,101.1,101.0,101.3,101.5,101.4,101.7,101.9,101.8,102.1,102.4,102.3,102.6,102.9,102.8,103.1,103.4,103.3,103.6,103.9,104.1,104.3,104.5],
  "volumes": [1000,1100,1050,1200,1150,1300,1250,1400,1350,1500,1450,1600,1550,1700,1650,1800,1750,1900,1850,2000,1950,2100,2050,2200,2150,2300,2250,2400,2350,2500],
  "highs": [100.5,100.6,100.8,100.7,101.0,101.2,101.1,101.4,101.6,101.5,101.8,102.0,101.9,102.2,102.4,102.3,102.6,102.9,102.8,103.1,103.4,103.3,103.6,103.9,103.8,104.1,104.4,104.6,104.8,105.0],
  "lows": [99.5,99.6,99.8,99.7,100.0,100.2,100.1,100.4,100.6,100.5,100.8,101.0,100.9,101.2,101.4,101.3,101.6,101.9,101.8,102.1,102.4,102.3,102.6,102.9,102.8,103.1,103.4,103.6,103.8,104.0]
}
```

`tests/fixtures/spike-heavy.json` — one ~12% spike day:

```json
{
  "closes": [100,100.5,101,100.8,101.2,100.9,101.5,101.2,101.8,102,113.4,113,112.5,113.1,112.8,113.3,113,112.5,113,113.2,112.8,113.5,113.2,113.8,114,113.5,114.2,114,114.5,114.8],
  "volumes": [1000,1100,1050,1200,1150,1300,1250,1400,1350,1500,8000,1450,1600,1550,1700,1650,1800,1750,1900,1850,2000,1950,2100,2050,2200,2150,2300,2250,2400,2350],
  "highs": [100.5,101,101.5,101.2,101.7,101.3,102,101.6,102.2,102.5,114,113.5,113,113.6,113.3,113.8,113.5,113,113.5,113.7,113.3,114,113.7,114.3,114.5,114,114.7,114.5,115,115.3],
  "lows": [99.5,100,100.5,100.3,100.7,100.4,101,100.7,101.3,101.5,100.5,112,111.8,112.4,112.1,112.6,112.3,111.8,112.3,112.5,112.1,112.8,112.5,113.1,113.3,112.8,113.5,113.3,113.8,114.1]
}
```

`tests/fixtures/flat.json` — flat, no trend, no volume change:

```json
{
  "closes": [100,100.1,99.9,100,100.05,99.95,100,100.1,99.95,100,100.05,99.9,100.1,100,99.95,100.05,100,99.9,100.1,100,100.05,99.95,100,100.1,99.95,100.05,100,99.9,100.1,100],
  "volumes": [1000,1010,990,1005,1000,995,1000,1010,990,1000,1005,990,1010,1000,995,1005,1000,990,1010,1000,1005,995,1000,1010,990,1005,1000,990,1010,1000],
  "highs": [100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5,100.5],
  "lows": [99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5,99.5]
}
```

- [ ] **Step 2: Write failing tests**

`tests/scoring.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePicks } from '../scripts/lib/scoring.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (name) =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf8'));

describe('scorePicks', () => {
  it('passes all 3 conditions on uptrend-accumulation fixture', () => {
    const r = scorePicks(load('uptrend-accumulation.json'));
    expect(r.passes.trendUp).toBe(true);
    expect(r.passes.volumeUp).toBe(true);
    expect(r.passes.accumulation).toBe(true);
    expect(r.total).toBeGreaterThan(0);
  });

  it('fails trendUp on spike-heavy fixture (spikeCount > 2 or maxDailyReturn >= 0.07)', () => {
    const r = scorePicks(load('spike-heavy.json'));
    expect(r.passes.trendUp).toBe(false);
  });

  it('fails on flat fixture (no slope, no volume increase)', () => {
    const r = scorePicks(load('flat.json'));
    expect(r.passes.trendUp).toBe(false);
    expect(r.passes.volumeUp).toBe(false);
  });

  it('returns metrics object for inspection', () => {
    const r = scorePicks(load('uptrend-accumulation.json'));
    expect(r.metrics).toHaveProperty('slope');
    expect(r.metrics).toHaveProperty('volRatio');
    expect(r.metrics).toHaveProperty('pricePosition');
    expect(r.metrics).toHaveProperty('maxDailyReturn');
    expect(r.metrics).toHaveProperty('spikeCount');
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npm test -- scoring
```

Expected: FAIL — `scorePicks` not defined.

- [ ] **Step 4: Implement `scripts/lib/scoring.mjs`**

```js
import { mean, linearRegression, obv } from './stats.mjs';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Score a single stock over 30 days of OHLCV.
 * Input: { closes:number[], volumes:number[], highs:number[], lows:number[] }
 * Output: { passes:{trendUp,volumeUp,accumulation}, scores:{A,B,C}, total:number, metrics:{...} }
 *
 * Conditions:
 *   A — gradual uptrend without spikes
 *   B — volume increasing
 *   C — accumulation near range low + rising OBV
 */
export function scorePicks(series) {
  const closes = series.closes.slice(-30);
  const volumes = series.volumes.slice(-30);
  const highs = series.highs.slice(-30);
  const lows = series.lows.slice(-30);

  // A: trend
  const slopeRaw = linearRegression(closes).slope;
  const slope = slopeRaw / closes[0]; // normalize to daily return
  const dailyReturns = [];
  for (let i = 1; i < closes.length; i++) {
    dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const maxDailyReturn = Math.max(...dailyReturns);
  const spikeCount = dailyReturns.filter((r) => r >= 0.05).length;
  const trendUp = slope > 0.001 && maxDailyReturn < 0.07 && spikeCount <= 2;
  const score_A = clamp(slope / 0.005, 0, 1) * (1 - spikeCount / 3);

  // B: volume
  const volFirst = mean(volumes.slice(0, 15));
  const volSecond = mean(volumes.slice(15));
  const volRatio = volFirst === 0 ? 0 : volSecond / volFirst;
  const logVols = volumes.map((v) => Math.log(Math.max(v, 1)));
  const volSlope = linearRegression(logVols).slope;
  const volumeUp = volRatio >= 1.3 && volSlope > 0;
  const score_B = clamp((volRatio - 1) / 1.0, 0, 1);

  // C: accumulation
  const high30 = Math.max(...highs);
  const low30 = Math.min(...lows);
  const range = high30 - low30;
  const pricePosition = range === 0 ? 0.5 : (closes[closes.length - 1] - low30) / range;
  const obvSeries = obv(closes, volumes);
  const obvSlope = linearRegression(obvSeries).slope;
  const meanVol = mean(volumes);
  const obvSlopeNormalized = meanVol === 0 ? 0 : clamp(obvSlope / meanVol, 0, 1);
  const accumulation = pricePosition <= 0.4 && obvSlope > 0;
  const score_C = (1 - pricePosition) * obvSlopeNormalized;

  const total = 0.35 * score_A + 0.30 * score_B + 0.35 * score_C;

  return {
    passes: { trendUp, volumeUp, accumulation },
    scores: { A: score_A, B: score_B, C: score_C },
    total,
    metrics: { slope, maxDailyReturn, spikeCount, volRatio, volSlope, pricePosition, obvSlope, obvSlopeNormalized },
  };
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- scoring
```

Expected: PASS — 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/scoring.mjs tests/scoring.test.mjs tests/fixtures/uptrend-accumulation.json tests/fixtures/spike-heavy.json tests/fixtures/flat.json
git commit -m "feat(scoring): 3-condition picks scorer with fixtures"
```

---

## Task 4: Regime scoring (`regime.mjs`) — TDD

**Files:**
- Create: `scripts/lib/regime.mjs`
- Create: `tests/regime.test.mjs`
- Create: `tests/fixtures/bull-index.json`

- [ ] **Step 1: Write fixture**

`tests/fixtures/bull-index.json` — synthetic index series (240 daily closes), gentle uptrend, low volatility:

Generate with a script comment in JSON header (commit the static result). Use this generator one-time mentally: `close[i] = 4000 * (1 + 0.0008 * i + 0.005 * sin(i / 10))` for i=0..239. Round to 2 decimals.

```json
{
  "closes": [4000.00,4003.55,4006.51,4008.42,4009.05,4008.20,4005.92,4002.47,3998.30,3993.95,3990.05,3987.13,3985.55,3985.50,3987.00,3989.90,3993.86,3998.40,4002.97,4007.07,4010.25,4012.20,4012.85,4012.30,4010.85,4008.96,4007.16,4006.05,4006.05,4007.40,4010.30,4014.80,4020.74,4027.86,4035.79,4044.06,4052.17,4059.66,4066.13,4071.32,4075.07,4077.39,4078.42,4078.46,4077.92,4077.27,4076.99,4077.46,4078.99,4081.78,4085.83,4091.05,4097.27,4104.21,4111.55,4118.93,4126.01,4132.51,4138.21,4143.05,4146.99,4150.10,4152.55,4154.59,4156.50,4158.59,4161.20,4164.59,4169.04,4174.69,4181.62,4189.79,4199.07,4209.20,4219.80,4230.36,4240.34,4249.20,4256.50,4261.89,4265.21,4266.46,4265.81,4263.62,4260.41,4256.78,4253.34,4250.66,4249.18,4249.21,4250.85,4254.05,4258.59,4264.13,4270.27,4276.55,4282.53,4287.80,4292.02,4294.99,4296.69,4297.23,4296.93,4296.27,4295.79,4296.05,4297.51,4300.55,4305.31,4311.69,4319.37,4327.83,4336.46,4344.61,4351.69,4357.21,4360.85,4362.51,4362.30,4360.55,4357.76,4354.53,4351.50,4349.30,4348.45,4349.27,4351.81,4355.93,4361.31,4367.51,4374.02,4380.31,4385.85,4390.21,4393.07,4394.27,4393.85,4391.97,4388.97,4385.27,4381.40,4377.91,4375.30,4373.97,4374.18,4376.03,4379.43,4384.13,4389.78,4395.99,4402.31,4408.31,4413.62,4417.94,4421.06,4422.90,4423.45,4422.83,4421.27,4419.05,4416.57,4414.21,4412.32,4411.18,4410.95,4411.65,4413.16,4415.27,4417.66,4419.95,4421.78,4422.85,4422.97,4422.13,4420.45,4418.20,4415.73,4413.42,4411.66,4410.79,4411.00,4412.30,4414.60,4417.69,4421.21,4424.78,4428.03,4430.66,4432.46,4433.34,4433.32,4432.51,4431.13,4429.45,4427.76,4426.32,4425.37,4425.05,4425.41,4426.42,4427.96,4429.83,4431.77,4433.49,4434.74,4435.34,4435.20,4434.36,4432.96,4431.20,4429.34,4427.64,4426.30,4425.49,4425.27,4425.62,4426.45,4427.62,4428.93,4430.18,4431.13,4431.62,4431.55,4430.89,4429.73,4428.21,4426.49,4424.77,4423.20,4421.96,4421.16,4420.87,4421.13,4421.89,4423.05,4424.48,4425.99,4427.39,4428.51,4429.20,4429.40,4429.10,4428.37,4427.31,4426.05]
}
```

- [ ] **Step 2: Write failing tests**

`tests/regime.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreRegime, labelFromScore } from '../scripts/lib/regime.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (name) =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf8'));

describe('scoreRegime', () => {
  it('returns positive score for bull index with low VIX', () => {
    const { closes } = load('bull-index.json');
    const r = scoreRegime({ closes, vix: 13.5, market: 'US' });
    expect(r.score).toBeGreaterThan(0);
    expect(r.metrics.trend).toBe('up');
  });

  it('returns negative score when closes < MA200 + high VIX', () => {
    const { closes } = load('bull-index.json');
    const downward = [...closes].reverse(); // now descending
    const r = scoreRegime({ closes: downward, vix: 30, market: 'US' });
    expect(r.score).toBeLessThan(0);
    expect(r.metrics.trend).toBe('down');
  });

  it('uses vol20 instead of VIX for KR market', () => {
    const { closes } = load('bull-index.json');
    const r = scoreRegime({ closes, vix: null, market: 'KR' });
    expect(r.metrics).toHaveProperty('vol20');
    expect(r.metrics.vix).toBe(null);
  });
});

describe('labelFromScore', () => {
  it('+3 → 풀매수', () => {
    expect(labelFromScore(3).label).toBe('풀매수');
    expect(labelFromScore(3).weight).toBe('90~100%');
  });
  it('+1 → 분할매수', () => {
    expect(labelFromScore(1).label).toBe('분할매수');
  });
  it('0 → 관망/존버', () => {
    expect(labelFromScore(0).label).toBe('관망/존버');
  });
  it('-2 → 비중축소+이익실현', () => {
    expect(labelFromScore(-2).label).toBe('비중축소+이익실현');
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npm test -- regime
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `scripts/lib/regime.mjs`**

```js
import { mean, stdev, linearRegression } from './stats.mjs';

function ma(closes, n) {
  if (closes.length < n) return null;
  return mean(closes.slice(-n));
}

/**
 * Compute regime score for a single market.
 * Input: { closes:number[] (>=200), vix:number|null, market:'KR'|'US' }
 * Output: { score:number, metrics:{trend,mom1m,mom3m,vol20,vix} }
 */
export function scoreRegime({ closes, vix, market }) {
  const ma50 = ma(closes, 50);
  const ma200 = ma(closes, 200);
  const last = closes[closes.length - 1];

  let trend;
  if (ma50 != null && ma200 != null && last > ma50 && ma50 > ma200) trend = 'up';
  else if (ma200 != null && last < ma200) trend = 'down';
  else trend = 'chop';

  const mom1m = closes.length >= 22 ? last / closes[closes.length - 22] - 1 : 0;
  const mom3m = closes.length >= 64 ? last / closes[closes.length - 64] - 1 : 0;

  const returns = [];
  for (let i = closes.length - 20; i < closes.length; i++) {
    if (i <= 0) continue;
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const vol20 = stdev(returns) * Math.sqrt(252);

  let score = 0;
  if (trend === 'up') score += 2;
  else if (trend === 'down') score -= 2;
  if (mom1m > 0.02) score += 1;
  else if (mom1m < -0.02) score -= 1;
  if (mom3m > 0.05) score += 1;
  else if (mom3m < -0.05) score -= 1;

  if (market === 'US' && vix != null) {
    if (vix < 18) score += 1;
    else if (vix > 25) score -= 1;
  } else {
    // KR: use vol20 thresholds
    if (vol20 < 0.15) score += 1;
    else if (vol20 > 0.30) score -= 1;
  }

  return {
    score,
    metrics: { trend, mom1m, mom3m, vol20, vix: market === 'US' ? vix : null, ma50, ma200 },
  };
}

export function labelFromScore(score) {
  if (score >= 3)   return { label: '풀매수',          weight: '90~100%' };
  if (score >= 1)   return { label: '분할매수',        weight: '60~80%'  };
  if (score >= -1)  return { label: '관망/존버',       weight: '40~60%'  };
  return              { label: '비중축소+이익실현', weight: '10~30%'  };
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -- regime
```

Expected: PASS — 7 tests green.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/regime.mjs tests/regime.test.mjs tests/fixtures/bull-index.json
git commit -m "feat(regime): market regime scorer + label mapping"
```

---

## Task 5: Fear gauge (`fear-gauge.mjs`) — TDD

**Files:**
- Create: `scripts/lib/fear-gauge.mjs`
- Create: `tests/fear-gauge.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/fear-gauge.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { fearGauge } from '../scripts/lib/fear-gauge.mjs';

describe('fearGauge', () => {
  it('VIX < 14 → 극도의 탐욕', () => {
    const r = fearGauge(12);
    expect(r.level).toBe('극도의 탐욕');
    expect(r.step).toBe(1);
    expect(r.color).toBe('extremeGreed');
  });
  it('VIX 16 → 탐욕', () => {
    expect(fearGauge(16).level).toBe('탐욕');
  });
  it('VIX 20 → 중립', () => {
    expect(fearGauge(20).level).toBe('중립');
  });
  it('VIX 25 → 공포', () => {
    expect(fearGauge(25).level).toBe('공포');
  });
  it('VIX 32 → 극도의 공포', () => {
    expect(fearGauge(32).level).toBe('극도의 공포');
    expect(fearGauge(32).step).toBe(5);
  });
  it('returns comment string', () => {
    expect(fearGauge(16).comment).toMatch(/위험|좋|강세/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- fear-gauge
```

Expected: FAIL.

- [ ] **Step 3: Implement `scripts/lib/fear-gauge.mjs`**

```js
/**
 * Map VIX to 5-step fear gauge.
 * Input: VIX numeric value
 * Output: { vix, level, step (1-5), color, comment }
 */
export function fearGauge(vix) {
  if (vix < 14)   return { vix, level: '극도의 탐욕',  step: 1, color: 'extremeGreed', comment: '시장 너무 들떠 있음. 과열 조심.' };
  if (vix < 18)   return { vix, level: '탐욕',         step: 2, color: 'greed',        comment: '분위기 좋음. 위험 자산 강세.' };
  if (vix < 22)   return { vix, level: '중립',         step: 3, color: 'neutral',      comment: '평소 수준. 평범한 시장.' };
  if (vix < 28)   return { vix, level: '공포',         step: 4, color: 'fear',         comment: '겁먹기 시작. 신중하게.' };
  return                 { vix, level: '극도의 공포',  step: 5, color: 'extremeFear',  comment: '공포 극심. 이럴 때 바닥 만들어짐.' };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- fear-gauge
```

Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/fear-gauge.mjs tests/fear-gauge.test.mjs
git commit -m "feat(fear-gauge): VIX to 5-step level mapping"
```

---

## Task 6: Pick reason templates (`reason-template.mjs`) — TDD

**Files:**
- Create: `scripts/lib/reason-template.mjs`
- Create: `tests/reason-template.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/reason-template.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { pickReason } from '../scripts/lib/reason-template.mjs';

describe('pickReason', () => {
  it('all three conditions strong → mentions all three in user-friendly terms', () => {
    const reason = pickReason({
      scores: { A: 0.8, B: 0.8, C: 0.8 },
      metrics: { slope: 0.003, volRatio: 1.7, pricePosition: 0.25 },
    });
    expect(reason).toMatch(/우상향|상승/);
    expect(reason).toMatch(/거래량|매수세/);
    expect(reason).toMatch(/저점|바닥|매집/);
  });

  it('volume + accumulation dominant → highlights those two', () => {
    const reason = pickReason({
      scores: { A: 0.2, B: 0.9, C: 0.9 },
      metrics: { slope: 0.0012, volRatio: 2.1, pricePosition: 0.15 },
    });
    expect(reason).toMatch(/거래량|매수세|매집/);
    expect(reason).toMatch(/바닥|저점|매집/);
  });

  it('does not contain technical jargon', () => {
    const reason = pickReason({
      scores: { A: 0.8, B: 0.8, C: 0.8 },
      metrics: { slope: 0.003, volRatio: 1.7, pricePosition: 0.25 },
    });
    expect(reason).not.toMatch(/OBV|slope|regression|stdev/i);
  });

  it('returns non-empty string for any input', () => {
    expect(pickReason({ scores: { A: 0.1, B: 0.1, C: 0.1 }, metrics: { slope: 0, volRatio: 1, pricePosition: 0.5 } })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- reason-template
```

Expected: FAIL.

- [ ] **Step 3: Implement `scripts/lib/reason-template.mjs`**

```js
/**
 * Generate a one-line, user-friendly pick reason.
 * Picks the dominant 2 of {A=trend, B=volume, C=accumulation} and composes a sentence.
 * Never exposes technical terms (slope, OBV, regression).
 */
export function pickReason({ scores, metrics }) {
  const volMult = metrics.volRatio.toFixed(1);
  const dailyPct = (metrics.slope * 100).toFixed(1);

  const fragments = {
    A_strong: `완만하게 우상향(일평균 ${dailyPct}%)`,
    A_mild: '꾸준히 우상향',
    B_strong: `거래량 ${volMult}배 증가`,
    B_mild: '거래량 증가세',
    C_strong: '바닥권에서 조용히 매집',
    C_mild: '저점권 매수세',
  };

  const ranked = Object.entries(scores)
    .map(([k, v]) => ({ k, v }))
    .sort((a, b) => b.v - a.v);

  const parts = ranked.slice(0, 2).map(({ k, v }) => {
    const tier = v >= 0.5 ? 'strong' : 'mild';
    return fragments[`${k}_${tier}`];
  });

  return `${parts[0]} + ${parts[1]}.`;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- reason-template
```

Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/reason-template.mjs tests/reason-template.test.mjs
git commit -m "feat(reason-template): user-friendly pick reasons"
```

---

## Task 7: Market comment templates (`market-comment.mjs`) — TDD

**Files:**
- Create: `scripts/lib/market-comment.mjs`
- Create: `tests/market-comment.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/market-comment.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { marketComment, overallComment } from '../scripts/lib/market-comment.mjs';

describe('marketComment', () => {
  it('풀매수 label → 적극 표현', () => {
    expect(marketComment('풀매수')).toMatch(/적극|들고|강|좋/);
  });
  it('분할매수 → 나눠서 표현', () => {
    expect(marketComment('분할매수')).toMatch(/나눠|분할|일부/);
  });
  it('관망/존버 → 가만히 표현', () => {
    expect(marketComment('관망/존버')).toMatch(/가만|관망|존버|기다/);
  });
  it('비중축소+이익실현 → 현금화/이익 표현', () => {
    expect(marketComment('비중축소+이익실현')).toMatch(/현금|이익|축소|챙겨/);
  });
});

describe('overallComment', () => {
  it('all markets bullish → bullish overall', () => {
    const r = overallComment([
      { label: '풀매수' },
      { label: '풀매수' },
      { label: '분할매수' },
      { label: '풀매수' },
    ]);
    expect(r.weight).toMatch(/80|90|100/);
    expect(r.comment).toMatch(/좋|양호|강세|적극/);
  });
  it('all markets bearish → defensive overall', () => {
    const r = overallComment([
      { label: '비중축소+이익실현' },
      { label: '비중축소+이익실현' },
      { label: '관망/존버' },
      { label: '비중축소+이익실현' },
    ]);
    expect(r.weight).toMatch(/10|20|30/);
    expect(r.comment).toMatch(/축소|현금|위험|조심|이익/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- market-comment
```

Expected: FAIL.

- [ ] **Step 3: Implement `scripts/lib/market-comment.mjs`**

```js
const COMMENT = {
  '풀매수':            '추세 강하고 변동성 작음. 지금은 적극 들고 가도 됨.',
  '분할매수':          '방향은 위지만 흔들림 있음. 한 번에 다 넣지 말고 나눠서.',
  '관망/존버':         '방향 애매. 무리해서 사지도 팔지도 말고 가만히.',
  '비중축소+이익실현': '추세 꺾이고 공포 커짐. 일부 현금화하고 이익 챙겨둘 때.',
};

export function marketComment(label) {
  return COMMENT[label] ?? '데이터 부족.';
}

const WEIGHT_VALUE = {
  '풀매수': 95,
  '분할매수': 70,
  '관망/존버': 50,
  '비중축소+이익실현': 20,
};

const WEIGHT_RANGE = (avg) => {
  if (avg >= 85) return '90~100%';
  if (avg >= 65) return '70~85%';
  if (avg >= 40) return '40~60%';
  return '10~30%';
};

const OVERALL_TEXT = (avg) => {
  if (avg >= 85) return '글로벌 분위기 강세. 적극 비중 유지.';
  if (avg >= 65) return '글로벌 분위기 양호. 분할 매수 위주.';
  if (avg >= 40) return '시장 혼조. 무리한 진입 자제.';
  return '위험 자산 회피 국면. 일부 현금화하고 이익 챙길 것.';
};

export function overallComment(markets) {
  const values = markets.map((m) => WEIGHT_VALUE[m.label] ?? 50);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return { weight: WEIGHT_RANGE(avg), comment: OVERALL_TEXT(avg) };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- market-comment
```

Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/market-comment.mjs tests/market-comment.test.mjs
git commit -m "feat(market-comment): market label/overall comment templates"
```

---

## Task 8: Yahoo fetch utility (`fetch-yahoo.mjs`)

**Files:**
- Create: `scripts/fetch-yahoo.mjs`

No tests — this is a thin wrapper around `fetch()` with retry. It's manually validated via the scanner runs.

- [ ] **Step 1: Implement `scripts/fetch-yahoo.mjs`**

```js
const YAHOO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch daily OHLCV from Yahoo chart endpoint.
 * range: '1mo' | '3mo' | '6mo' | '1y' | '2y'
 * Returns: { closes:number[], volumes:number[], highs:number[], lows:number[], meta } | null
 */
export async function fetchChart(ticker, range = '4mo') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) {
      console.warn(`[fetch] HTTP ${res.status} for ${ticker}`);
      return null;
    }
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta ?? {};
    const q = result.indicators?.quote?.[0] ?? {};
    const closes = (q.close ?? []).filter((v) => v != null);
    const volumes = (q.volume ?? []).filter((v) => v != null);
    const highs = (q.high ?? []).filter((v) => v != null);
    const lows = (q.low ?? []).filter((v) => v != null);
    if (closes.length === 0) return null;
    return {
      closes,
      volumes,
      highs,
      lows,
      meta: {
        price: meta.regularMarketPrice ?? closes[closes.length - 1],
        currency: meta.currency ?? null,
        exchange: meta.exchangeName ?? null,
      },
    };
  } catch (e) {
    console.warn(`[fetch] failed for ${ticker}: ${e.message}`);
    return null;
  }
}

/**
 * Fetch many tickers sequentially with throttling.
 * progressEvery: log progress every N fetches (default 50).
 */
export async function fetchMany(tickers, { range = '4mo', delayMs = 200, progressEvery = 50 } = {}) {
  const out = [];
  for (let i = 0; i < tickers.length; i++) {
    const t = tickers[i];
    const data = await fetchChart(t.ticker ?? t, range);
    out.push({ ...t, data });
    if ((i + 1) % progressEvery === 0) {
      console.log(`[fetch] ${i + 1}/${tickers.length} done`);
    }
    await sleep(delayMs);
  }
  return out;
}
```

- [ ] **Step 2: Smoke-test manually**

```bash
node -e "import('./scripts/fetch-yahoo.mjs').then(async m => { const r = await m.fetchChart('AAPL', '1mo'); console.log('closes len:', r?.closes.length); })"
```

Expected: `closes len: ~21` (≈ 1 month of trading days).

- [ ] **Step 3: Commit**

```bash
git add scripts/fetch-yahoo.mjs
git commit -m "feat(fetch): Yahoo chart endpoint client with throttling"
```

---

## Task 9: Universe seed lists

**Files:**
- Create: `scripts/universe-kr.json`
- Create: `scripts/universe-us.json`

Ship a curated seed universe for v1 to keep scan time and reliability manageable. Full universe expansion is v2.

**KR seed:** KOSPI 50 + KOSDAQ 50 — the most liquid Korean names. **US seed:** Top 100 by market cap from S&P500.

- [ ] **Step 1: Write `scripts/universe-kr.json`**

100 entries. Format `{ ticker, name, market }` where ticker uses Yahoo suffix `.KS` (KOSPI) or `.KQ` (KOSDAQ).

```json
[
  { "ticker": "005930.KS", "name": "삼성전자", "market": "KOSPI" },
  { "ticker": "000660.KS", "name": "SK하이닉스", "market": "KOSPI" },
  { "ticker": "373220.KS", "name": "LG에너지솔루션", "market": "KOSPI" },
  { "ticker": "207940.KS", "name": "삼성바이오로직스", "market": "KOSPI" },
  { "ticker": "005380.KS", "name": "현대차", "market": "KOSPI" },
  { "ticker": "000270.KS", "name": "기아", "market": "KOSPI" },
  { "ticker": "005490.KS", "name": "POSCO홀딩스", "market": "KOSPI" },
  { "ticker": "105560.KS", "name": "KB금융", "market": "KOSPI" },
  { "ticker": "035420.KS", "name": "NAVER", "market": "KOSPI" },
  { "ticker": "068270.KS", "name": "셀트리온", "market": "KOSPI" },
  { "ticker": "055550.KS", "name": "신한지주", "market": "KOSPI" },
  { "ticker": "035720.KS", "name": "카카오", "market": "KOSPI" },
  { "ticker": "012330.KS", "name": "현대모비스", "market": "KOSPI" },
  { "ticker": "028260.KS", "name": "삼성물산", "market": "KOSPI" },
  { "ticker": "066570.KS", "name": "LG전자", "market": "KOSPI" },
  { "ticker": "003670.KS", "name": "포스코퓨처엠", "market": "KOSPI" },
  { "ticker": "086790.KS", "name": "하나금융지주", "market": "KOSPI" },
  { "ticker": "032830.KS", "name": "삼성생명", "market": "KOSPI" },
  { "ticker": "015760.KS", "name": "한국전력", "market": "KOSPI" },
  { "ticker": "033780.KS", "name": "KT&G", "market": "KOSPI" },
  { "ticker": "017670.KS", "name": "SK텔레콤", "market": "KOSPI" },
  { "ticker": "316140.KS", "name": "우리금융지주", "market": "KOSPI" },
  { "ticker": "009540.KS", "name": "HD한국조선해양", "market": "KOSPI" },
  { "ticker": "010130.KS", "name": "고려아연", "market": "KOSPI" },
  { "ticker": "051910.KS", "name": "LG화학", "market": "KOSPI" },
  { "ticker": "006400.KS", "name": "삼성SDI", "market": "KOSPI" },
  { "ticker": "096770.KS", "name": "SK이노베이션", "market": "KOSPI" },
  { "ticker": "034730.KS", "name": "SK", "market": "KOSPI" },
  { "ticker": "030200.KS", "name": "KT", "market": "KOSPI" },
  { "ticker": "018260.KS", "name": "삼성에스디에스", "market": "KOSPI" },
  { "ticker": "024110.KS", "name": "기업은행", "market": "KOSPI" },
  { "ticker": "011200.KS", "name": "HMM", "market": "KOSPI" },
  { "ticker": "021240.KS", "name": "코웨이", "market": "KOSPI" },
  { "ticker": "010950.KS", "name": "S-Oil", "market": "KOSPI" },
  { "ticker": "036570.KS", "name": "엔씨소프트", "market": "KOSPI" },
  { "ticker": "267260.KS", "name": "HD현대일렉트릭", "market": "KOSPI" },
  { "ticker": "047810.KS", "name": "한국항공우주", "market": "KOSPI" },
  { "ticker": "012450.KS", "name": "한화에어로스페이스", "market": "KOSPI" },
  { "ticker": "352820.KS", "name": "하이브", "market": "KOSPI" },
  { "ticker": "180640.KS", "name": "한진칼", "market": "KOSPI" },
  { "ticker": "139480.KS", "name": "이마트", "market": "KOSPI" },
  { "ticker": "402340.KS", "name": "SK스퀘어", "market": "KOSPI" },
  { "ticker": "326030.KS", "name": "SK바이오팜", "market": "KOSPI" },
  { "ticker": "011170.KS", "name": "롯데케미칼", "market": "KOSPI" },
  { "ticker": "032640.KS", "name": "LG유플러스", "market": "KOSPI" },
  { "ticker": "001040.KS", "name": "CJ", "market": "KOSPI" },
  { "ticker": "010620.KS", "name": "현대미포조선", "market": "KOSPI" },
  { "ticker": "086280.KS", "name": "현대글로비스", "market": "KOSPI" },
  { "ticker": "000810.KS", "name": "삼성화재", "market": "KOSPI" },
  { "ticker": "138930.KS", "name": "BNK금융지주", "market": "KOSPI" },
  { "ticker": "247540.KQ", "name": "에코프로비엠", "market": "KOSDAQ" },
  { "ticker": "086520.KQ", "name": "에코프로", "market": "KOSDAQ" },
  { "ticker": "091990.KQ", "name": "셀트리온헬스케어", "market": "KOSDAQ" },
  { "ticker": "196170.KQ", "name": "알테오젠", "market": "KOSDAQ" },
  { "ticker": "066970.KQ", "name": "엘앤에프", "market": "KOSDAQ" },
  { "ticker": "035900.KQ", "name": "JYP Ent.", "market": "KOSDAQ" },
  { "ticker": "041510.KQ", "name": "에스엠", "market": "KOSDAQ" },
  { "ticker": "112040.KQ", "name": "위메이드", "market": "KOSDAQ" },
  { "ticker": "095340.KQ", "name": "ISC", "market": "KOSDAQ" },
  { "ticker": "058470.KQ", "name": "리노공업", "market": "KOSDAQ" },
  { "ticker": "067310.KQ", "name": "하나마이크론", "market": "KOSDAQ" },
  { "ticker": "240810.KQ", "name": "원익IPS", "market": "KOSDAQ" },
  { "ticker": "036930.KQ", "name": "주성엔지니어링", "market": "KOSDAQ" },
  { "ticker": "278280.KQ", "name": "천보", "market": "KOSDAQ" },
  { "ticker": "357780.KQ", "name": "솔브레인", "market": "KOSDAQ" },
  { "ticker": "039030.KQ", "name": "이오테크닉스", "market": "KOSDAQ" },
  { "ticker": "228760.KQ", "name": "지노믹트리", "market": "KOSDAQ" },
  { "ticker": "365340.KQ", "name": "성일하이텍", "market": "KOSDAQ" },
  { "ticker": "298380.KQ", "name": "에이비엘바이오", "market": "KOSDAQ" },
  { "ticker": "214150.KQ", "name": "클래시스", "market": "KOSDAQ" },
  { "ticker": "145020.KQ", "name": "휴젤", "market": "KOSDAQ" },
  { "ticker": "263750.KQ", "name": "펄어비스", "market": "KOSDAQ" },
  { "ticker": "293490.KQ", "name": "카카오게임즈", "market": "KOSDAQ" },
  { "ticker": "192080.KQ", "name": "더블유게임즈", "market": "KOSDAQ" },
  { "ticker": "078340.KQ", "name": "컴투스", "market": "KOSDAQ" },
  { "ticker": "950140.KQ", "name": "잉글우드랩", "market": "KOSDAQ" },
  { "ticker": "086900.KQ", "name": "메디톡스", "market": "KOSDAQ" },
  { "ticker": "025900.KQ", "name": "동화기업", "market": "KOSDAQ" },
  { "ticker": "065350.KQ", "name": "신성델타테크", "market": "KOSDAQ" },
  { "ticker": "393890.KQ", "name": "더블유씨피", "market": "KOSDAQ" },
  { "ticker": "108860.KQ", "name": "셀바스AI", "market": "KOSDAQ" },
  { "ticker": "402030.KQ", "name": "코셈", "market": "KOSDAQ" },
  { "ticker": "418550.KQ", "name": "제이엠멀티", "market": "KOSDAQ" },
  { "ticker": "060280.KQ", "name": "큐렉소", "market": "KOSDAQ" },
  { "ticker": "166090.KQ", "name": "하나머티리얼즈", "market": "KOSDAQ" },
  { "ticker": "131970.KQ", "name": "테스나", "market": "KOSDAQ" },
  { "ticker": "323990.KQ", "name": "박셀바이오", "market": "KOSDAQ" },
  { "ticker": "041960.KQ", "name": "코미팜", "market": "KOSDAQ" },
  { "ticker": "950130.KQ", "name": "엑세스바이오", "market": "KOSDAQ" },
  { "ticker": "237690.KQ", "name": "에스티팜", "market": "KOSDAQ" },
  { "ticker": "115450.KQ", "name": "지엔씨에너지", "market": "KOSDAQ" },
  { "ticker": "319660.KQ", "name": "피에스케이", "market": "KOSDAQ" },
  { "ticker": "036540.KQ", "name": "SFA반도체", "market": "KOSDAQ" },
  { "ticker": "200470.KQ", "name": "메가스터디교육", "market": "KOSDAQ" },
  { "ticker": "032500.KQ", "name": "케이엠더블유", "market": "KOSDAQ" },
  { "ticker": "048410.KQ", "name": "현대바이오", "market": "KOSDAQ" },
  { "ticker": "067160.KQ", "name": "아프리카TV", "market": "KOSDAQ" },
  { "ticker": "950170.KQ", "name": "JTC", "market": "KOSDAQ" },
  { "ticker": "263050.KQ", "name": "유니테스트", "market": "KOSDAQ" },
  { "ticker": "182360.KQ", "name": "큐브엔터", "market": "KOSDAQ" },
  { "ticker": "377300.KQ", "name": "카카오페이", "market": "KOSDAQ" }
]
```

- [ ] **Step 2: Write `scripts/universe-us.json`**

100 US large-caps:

```json
[
  { "ticker": "AAPL", "name": "Apple",      "market": "NASDAQ" },
  { "ticker": "MSFT", "name": "Microsoft",  "market": "NASDAQ" },
  { "ticker": "NVDA", "name": "NVIDIA",     "market": "NASDAQ" },
  { "ticker": "GOOGL","name": "Alphabet A", "market": "NASDAQ" },
  { "ticker": "GOOG", "name": "Alphabet C", "market": "NASDAQ" },
  { "ticker": "AMZN", "name": "Amazon",     "market": "NASDAQ" },
  { "ticker": "META", "name": "Meta",       "market": "NASDAQ" },
  { "ticker": "TSLA", "name": "Tesla",      "market": "NASDAQ" },
  { "ticker": "BRK-B","name": "Berkshire B","market": "NYSE" },
  { "ticker": "LLY",  "name": "Eli Lilly",  "market": "NYSE" },
  { "ticker": "AVGO", "name": "Broadcom",   "market": "NASDAQ" },
  { "ticker": "JPM",  "name": "JPMorgan",   "market": "NYSE" },
  { "ticker": "WMT",  "name": "Walmart",    "market": "NYSE" },
  { "ticker": "V",    "name": "Visa",       "market": "NYSE" },
  { "ticker": "XOM",  "name": "Exxon",      "market": "NYSE" },
  { "ticker": "UNH",  "name": "UnitedHealth","market": "NYSE" },
  { "ticker": "MA",   "name": "Mastercard", "market": "NYSE" },
  { "ticker": "PG",   "name": "P&G",        "market": "NYSE" },
  { "ticker": "JNJ",  "name": "J&J",        "market": "NYSE" },
  { "ticker": "ORCL", "name": "Oracle",     "market": "NYSE" },
  { "ticker": "HD",   "name": "Home Depot", "market": "NYSE" },
  { "ticker": "COST", "name": "Costco",     "market": "NASDAQ" },
  { "ticker": "ABBV", "name": "AbbVie",     "market": "NYSE" },
  { "ticker": "BAC",  "name": "Bank of America","market": "NYSE" },
  { "ticker": "MRK",  "name": "Merck",      "market": "NYSE" },
  { "ticker": "CVX",  "name": "Chevron",    "market": "NYSE" },
  { "ticker": "KO",   "name": "Coca-Cola",  "market": "NYSE" },
  { "ticker": "ADBE", "name": "Adobe",      "market": "NASDAQ" },
  { "ticker": "PEP",  "name": "PepsiCo",    "market": "NASDAQ" },
  { "ticker": "CRM",  "name": "Salesforce", "market": "NYSE" },
  { "ticker": "NFLX", "name": "Netflix",    "market": "NASDAQ" },
  { "ticker": "WFC",  "name": "Wells Fargo","market": "NYSE" },
  { "ticker": "TMO",  "name": "Thermo Fisher","market": "NYSE" },
  { "ticker": "AMD",  "name": "AMD",        "market": "NASDAQ" },
  { "ticker": "CSCO", "name": "Cisco",      "market": "NASDAQ" },
  { "ticker": "ACN",  "name": "Accenture",  "market": "NYSE" },
  { "ticker": "MCD",  "name": "McDonald's", "market": "NYSE" },
  { "ticker": "DIS",  "name": "Disney",     "market": "NYSE" },
  { "ticker": "ABT",  "name": "Abbott",     "market": "NYSE" },
  { "ticker": "DHR",  "name": "Danaher",    "market": "NYSE" },
  { "ticker": "LIN",  "name": "Linde",      "market": "NYSE" },
  { "ticker": "TXN",  "name": "Texas Instruments","market": "NASDAQ" },
  { "ticker": "INTC", "name": "Intel",      "market": "NASDAQ" },
  { "ticker": "PM",   "name": "Philip Morris","market": "NYSE" },
  { "ticker": "VZ",   "name": "Verizon",    "market": "NYSE" },
  { "ticker": "CMCSA","name": "Comcast",    "market": "NASDAQ" },
  { "ticker": "IBM",  "name": "IBM",        "market": "NYSE" },
  { "ticker": "QCOM", "name": "Qualcomm",   "market": "NASDAQ" },
  { "ticker": "NKE",  "name": "Nike",       "market": "NYSE" },
  { "ticker": "INTU", "name": "Intuit",     "market": "NASDAQ" },
  { "ticker": "PFE",  "name": "Pfizer",     "market": "NYSE" },
  { "ticker": "UPS",  "name": "UPS",        "market": "NYSE" },
  { "ticker": "AMGN", "name": "Amgen",      "market": "NASDAQ" },
  { "ticker": "AMAT", "name": "Applied Materials","market": "NASDAQ" },
  { "ticker": "GE",   "name": "GE",         "market": "NYSE" },
  { "ticker": "T",    "name": "AT&T",       "market": "NYSE" },
  { "ticker": "RTX",  "name": "RTX",        "market": "NYSE" },
  { "ticker": "LOW",  "name": "Lowe's",     "market": "NYSE" },
  { "ticker": "HON",  "name": "Honeywell",  "market": "NASDAQ" },
  { "ticker": "SBUX", "name": "Starbucks",  "market": "NASDAQ" },
  { "ticker": "BA",   "name": "Boeing",     "market": "NYSE" },
  { "ticker": "BKNG", "name": "Booking",    "market": "NASDAQ" },
  { "ticker": "SPGI", "name": "S&P Global", "market": "NYSE" },
  { "ticker": "ELV",  "name": "Elevance",   "market": "NYSE" },
  { "ticker": "GS",   "name": "Goldman Sachs","market": "NYSE" },
  { "ticker": "BLK",  "name": "BlackRock",  "market": "NYSE" },
  { "ticker": "ISRG", "name": "Intuitive Surgical","market": "NASDAQ" },
  { "ticker": "DE",   "name": "Deere",      "market": "NYSE" },
  { "ticker": "PLD",  "name": "Prologis",   "market": "NYSE" },
  { "ticker": "GILD", "name": "Gilead",     "market": "NASDAQ" },
  { "ticker": "AXP",  "name": "Amex",       "market": "NYSE" },
  { "ticker": "MMC",  "name": "Marsh McLennan","market": "NYSE" },
  { "ticker": "VRTX", "name": "Vertex",     "market": "NASDAQ" },
  { "ticker": "REGN", "name": "Regeneron",  "market": "NASDAQ" },
  { "ticker": "ETN",  "name": "Eaton",      "market": "NYSE" },
  { "ticker": "ADP",  "name": "ADP",        "market": "NASDAQ" },
  { "ticker": "PANW", "name": "Palo Alto",  "market": "NASDAQ" },
  { "ticker": "SCHW", "name": "Schwab",     "market": "NYSE" },
  { "ticker": "MS",   "name": "Morgan Stanley","market": "NYSE" },
  { "ticker": "C",    "name": "Citigroup",  "market": "NYSE" },
  { "ticker": "TJX",  "name": "TJX",        "market": "NYSE" },
  { "ticker": "MDLZ", "name": "Mondelez",   "market": "NASDAQ" },
  { "ticker": "MU",   "name": "Micron",     "market": "NASDAQ" },
  { "ticker": "LRCX", "name": "Lam Research","market": "NASDAQ" },
  { "ticker": "CB",   "name": "Chubb",      "market": "NYSE" },
  { "ticker": "ZTS",  "name": "Zoetis",     "market": "NYSE" },
  { "ticker": "ADI",  "name": "Analog Devices","market": "NASDAQ" },
  { "ticker": "CI",   "name": "Cigna",      "market": "NYSE" },
  { "ticker": "TMUS", "name": "T-Mobile",   "market": "NASDAQ" },
  { "ticker": "BMY",  "name": "Bristol-Myers","market": "NYSE" },
  { "ticker": "FI",   "name": "Fiserv",     "market": "NYSE" },
  { "ticker": "PYPL", "name": "PayPal",     "market": "NASDAQ" },
  { "ticker": "MO",   "name": "Altria",     "market": "NYSE" },
  { "ticker": "PGR",  "name": "Progressive","market": "NYSE" },
  { "ticker": "SO",   "name": "Southern",   "market": "NYSE" },
  { "ticker": "DUK",  "name": "Duke Energy","market": "NYSE" },
  { "ticker": "EQIX", "name": "Equinix",    "market": "NASDAQ" },
  { "ticker": "BX",   "name": "Blackstone", "market": "NYSE" },
  { "ticker": "NOW",  "name": "ServiceNow", "market": "NYSE" },
  { "ticker": "SHW",  "name": "Sherwin-Williams","market": "NYSE" },
  { "ticker": "CL",   "name": "Colgate",    "market": "NYSE" }
]
```

- [ ] **Step 3: Commit**

```bash
git add scripts/universe-kr.json scripts/universe-us.json
git commit -m "data: KR+US seed universe (100 each)"
```

---

## Task 10: Picks scanner (`scan-picks.mjs`)

**Files:**
- Create: `scripts/scan-picks.mjs`

- [ ] **Step 1: Implement `scripts/scan-picks.mjs`**

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMany } from './fetch-yahoo.mjs';
import { scorePicks } from './lib/scoring.mjs';
import { pickReason } from './lib/reason-template.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '../src/data/picks.json');

function load(name) {
  return JSON.parse(readFileSync(resolve(__dirname, name), 'utf8'));
}

function topN(rows, n) {
  return rows
    .filter((r) => r.passes.trendUp && r.passes.volumeUp && r.passes.accumulation)
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

async function scanGroup(universe, label) {
  console.log(`[scan-picks] ${label} ${universe.length} tickers...`);
  const fetched = await fetchMany(universe, { range: '4mo', delayMs: 200 });
  const scored = [];
  for (const row of fetched) {
    if (!row.data || row.data.closes.length < 30) continue;
    try {
      const s = scorePicks(row.data);
      scored.push({
        ticker: row.ticker,
        name: row.name,
        market: row.market,
        ...s,
        closes30: row.data.closes.slice(-30),
      });
    } catch (e) {
      console.warn(`[scan-picks] score failed for ${row.ticker}: ${e.message}`);
    }
  }
  return topN(scored, 3).map((r) => ({
    ticker: r.ticker,
    name: r.name,
    market: r.market,
    score: Math.round(r.total * 100),
    closes30: r.closes30,
    reason: pickReason({ scores: r.scores, metrics: r.metrics }),
  }));
}

async function main() {
  const kr = load('universe-kr.json');
  const us = load('universe-us.json');
  const krPicks = await scanGroup(kr, 'KR');
  const usPicks = await scanGroup(us, 'US');

  const out = {
    asOf: new Date().toISOString(),
    kr: krPicks,
    us: usPicks,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[scan-picks] wrote ${OUTPUT} — KR ${krPicks.length}, US ${usPicks.length}`);
}

main().catch((err) => {
  console.error('[scan-picks] failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the scanner end-to-end**

```bash
npm run scan:picks
```

Expected: ~7 minutes (200 tickers × 200ms ≈ 40 sec just for delays + fetch time). Output `src/data/picks.json` exists with `kr` and `us` arrays, length ≤ 3 each. If both arrays empty, that may simply mean no condition passes today — verify by inspecting a few `_debug` rows by temporarily logging.

- [ ] **Step 3: Verify JSON shape**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('src/data/picks.json')))"
```

Expected: `{ asOf, kr: [...], us: [...] }`. Each entry has `ticker, name, market, score, closes30, reason`.

- [ ] **Step 4: Commit (data + script)**

```bash
git add scripts/scan-picks.mjs src/data/picks.json
git commit -m "feat(scanner): picks scanner writes src/data/picks.json"
```

---

## Task 11: Regime scanner (`scan-regime.mjs`)

**Files:**
- Create: `scripts/scan-regime.mjs`

- [ ] **Step 1: Implement `scripts/scan-regime.mjs`**

```js
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChart } from './fetch-yahoo.mjs';
import { scoreRegime, labelFromScore } from './lib/regime.mjs';
import { fearGauge } from './lib/fear-gauge.mjs';
import { marketComment, overallComment } from './lib/market-comment.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '../src/data/regime.json');

const INDICES = [
  { code: 'KOSPI',  index: '^KS11',  emoji: '🇰🇷', region: 'KR' },
  { code: 'KOSDAQ', index: '^KQ11',  emoji: '🇰🇷', region: 'KR' },
  { code: 'SP500',  index: '^GSPC',  emoji: '🇺🇸', region: 'US' },
  { code: 'NASDAQ', index: '^IXIC',  emoji: '🇺🇸', region: 'US' },
];

async function main() {
  console.log('[scan-regime] fetching indices + VIX...');

  const vixData = await fetchChart('^VIX', '1mo');
  const vix = vixData?.closes?.[vixData.closes.length - 1] ?? null;

  const markets = [];
  for (const idx of INDICES) {
    const data = await fetchChart(idx.index, '1y');
    if (!data || data.closes.length < 64) {
      console.warn(`[scan-regime] insufficient data for ${idx.index}`);
      continue;
    }
    const r = scoreRegime({ closes: data.closes, vix: idx.region === 'US' ? vix : null, market: idx.region });
    const { label, weight } = labelFromScore(r.score);

    // Build last-60 closes + MA series for IndexChart.
    // ma50/ma200 arrays are aligned with closes60 (same length, leading nulls when window not yet filled).
    const closes = data.closes;
    const last60 = closes.slice(-60);
    const startIdx = closes.length - 60;
    const ma50 = last60.map((_, i) => {
      const globalIdx = startIdx + i;
      if (globalIdx < 49) return null;
      const window = closes.slice(globalIdx - 49, globalIdx + 1);
      return window.reduce((a, b) => a + b, 0) / 50;
    });
    const ma200 = last60.map((_, i) => {
      const globalIdx = startIdx + i;
      if (globalIdx < 199) return null;
      const window = closes.slice(globalIdx - 199, globalIdx + 1);
      return window.reduce((a, b) => a + b, 0) / 200;
    });

    markets.push({
      code: idx.code,
      emoji: idx.emoji,
      label,
      weight,
      score: r.score,
      comment: marketComment(label),
      closes60: last60,
      ma50,
      ma200,
      _debug: r.metrics,
    });
  }

  const gauge = vix != null ? fearGauge(vix) : { vix: null, level: '데이터 없음', step: 3, color: 'neutral', comment: '' };
  const overall = overallComment(markets);

  const out = {
    asOf: new Date().toISOString(),
    fearGauge: gauge,
    markets,
    overall,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[scan-regime] wrote ${OUTPUT} — VIX ${vix}, ${markets.length} markets`);
}

main().catch((err) => {
  console.error('[scan-regime] failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run scanner**

```bash
npm run scan:regime
```

Expected: finishes in <30 sec. `src/data/regime.json` exists with `fearGauge`, `markets` (4 entries), `overall`.

- [ ] **Step 3: Verify**

```bash
node -e "const j = JSON.parse(require('fs').readFileSync('src/data/regime.json')); console.log('VIX:', j.fearGauge.vix, 'level:', j.fearGauge.level); console.log('markets:', j.markets.map(m=>m.code+' '+m.label).join(', '))"
```

Expected: prints VIX number + level + 4 market labels.

- [ ] **Step 4: Commit**

```bash
git add scripts/scan-regime.mjs src/data/regime.json
git commit -m "feat(scanner): regime scanner with fear gauge + market comments"
```

---

## Task 12: Base layout (`Base.astro`)

**Files:**
- Create: `src/layouts/Base.astro`

- [ ] **Step 1: Write `src/layouts/Base.astro`**

```astro
---
interface Props {
  title?: string;
  asOf?: string;
}
const { title = 'surgePick', asOf } = Astro.props;
const asOfText = asOf
  ? new Date(asOf).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' })
  : null;
---
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>{title}</title>
  </head>
  <body class="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased">
    <header class="px-4 pt-6 pb-4 flex items-baseline justify-between">
      <h1 class="text-2xl font-bold tracking-tight">surgePick</h1>
      {asOfText && <span class="text-xs text-slate-400">{asOfText} 기준</span>}
    </header>
    <main class="px-4 pb-12 max-w-screen-sm mx-auto sm:max-w-screen-md">
      <slot />
    </main>
    <footer class="px-4 py-8 max-w-screen-sm mx-auto sm:max-w-screen-md text-xs text-slate-500 text-center space-y-1">
      <p>본 사이트의 정보는 투자 판단의 참고용이며 매수/매도 추천이 아닙니다.</p>
      <p>모든 투자의 책임은 본인에게 있습니다. Source: Yahoo Finance</p>
    </footer>
  </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/layouts/Base.astro
git commit -m "feat(ui): base layout with mobile viewport + footer disclaimer"
```

---

## Task 13: ActionButton component

**Files:**
- Create: `src/components/ActionButton.astro`

- [ ] **Step 1: Write `src/components/ActionButton.astro`**

```astro
---
interface Props {
  target: string;  // e.g. "picks" | "mood"
  label: string;
  icon: string;
  color: 'pick' | 'mood';
}
const { target, label, icon, color } = Astro.props;
const bg = color === 'pick' ? 'bg-brand-pick' : 'bg-brand-mood';
---
<button
  type="button"
  data-target={target}
  class={`action-btn w-full min-h-[64px] rounded-2xl px-6 py-4 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-transform flex items-center justify-center gap-3 ${bg}`}
  aria-expanded="false"
  aria-controls={`section-${target}`}
>
  <span class="text-2xl" aria-hidden="true">{icon}</span>
  <span>{label}</span>
</button>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ActionButton.astro
git commit -m "feat(ui): ActionButton component"
```

---

## Task 14: Sparkline + PickCard components

**Files:**
- Create: `src/components/Sparkline.astro`
- Create: `src/components/PickCard.astro`

- [ ] **Step 1: Write `src/components/Sparkline.astro`**

```astro
---
interface Props {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}
const { values, width = 300, height = 60, color = '#60a5fa' } = Astro.props;

const min = Math.min(...values);
const max = Math.max(...values);
const range = max - min || 1;
const stepX = width / Math.max(values.length - 1, 1);
const points = values
  .map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  })
  .join(' ');
const areaPath = `M0,${height} L${points.replace(/ /g, ' L')} L${width},${height} Z`;
const gradId = `g${Math.random().toString(36).slice(2, 8)}`;
---
<svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" class="w-full h-[60px]" aria-hidden="true">
  <defs>
    <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color={color} stop-opacity="0.4" />
      <stop offset="100%" stop-color={color} stop-opacity="0" />
    </linearGradient>
  </defs>
  <path d={areaPath} fill={`url(#${gradId})`} />
  <polyline points={points} fill="none" stroke={color} stroke-width="1.5" stroke-linejoin="round" />
</svg>
```

- [ ] **Step 2: Write `src/components/PickCard.astro`**

```astro
---
import Sparkline from './Sparkline.astro';
interface Props {
  ticker: string;
  name: string;
  score: number;
  closes30: number[];
  reason: string;
}
const { ticker, name, score, closes30, reason } = Astro.props;
---
<article class="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
  <header class="flex items-baseline justify-between">
    <div>
      <h3 class="text-base font-semibold">{name}</h3>
      <p class="text-xs text-slate-400">{ticker}</p>
    </div>
    <span class="text-sm font-medium text-brand-pick">score {score}</span>
  </header>
  <Sparkline values={closes30} color="#60a5fa" />
  <p class="text-sm leading-relaxed text-slate-200">{reason}</p>
</article>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Sparkline.astro src/components/PickCard.astro
git commit -m "feat(ui): Sparkline + PickCard components"
```

---

## Task 15: FearGaugeCard + MarketMoodCard + OverallCard

**Files:**
- Create: `src/components/FearGaugeCard.astro`
- Create: `src/components/MarketMoodCard.astro`
- Create: `src/components/OverallCard.astro`

- [ ] **Step 1: Write `src/components/FearGaugeCard.astro`**

```astro
---
interface Props {
  vix: number | null;
  level: string;
  step: number;
  color: string;
  comment: string;
}
const { vix, level, step, color, comment } = Astro.props;

const colorClass = {
  extremeGreed: 'text-fear-extremeGreed',
  greed: 'text-fear-greed',
  neutral: 'text-fear-neutral',
  fear: 'text-fear-fear',
  extremeFear: 'text-fear-extremeFear',
}[color] ?? 'text-slate-300';

const dotBg = {
  extremeGreed: 'bg-fear-extremeGreed',
  greed: 'bg-fear-greed',
  neutral: 'bg-fear-neutral',
  fear: 'bg-fear-fear',
  extremeFear: 'bg-fear-extremeFear',
}[color] ?? 'bg-slate-500';
---
<article class="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
  <header class="flex items-center justify-between">
    <h3 class="text-sm uppercase tracking-wider text-slate-400">🌡️ 공포지수</h3>
    <span class="text-xs text-slate-500">VIX</span>
  </header>
  <div class="flex items-baseline gap-3">
    <span class="text-4xl font-bold">{vix?.toFixed(1) ?? '—'}</span>
    <span class={`text-lg font-semibold ${colorClass}`}>{level}</span>
  </div>
  <div class="flex gap-2" role="presentation">
    {[1, 2, 3, 4, 5].map((s) => (
      <span class={`h-2 flex-1 rounded-full ${s <= step ? dotBg : 'bg-slate-700'}`} />
    ))}
  </div>
  <p class="text-sm text-slate-200 leading-relaxed">{comment}</p>
</article>
```

- [ ] **Step 2: Write `src/components/MarketMoodCard.astro`**

Note: this component imports `IndexChart` which is created in Task 24. If Task 24 is not yet done when this component is built, comment out the IndexChart usage temporarily and uncomment after Task 24 finishes — or build Task 24 first then return here.

```astro
---
import IndexChart from './IndexChart.astro';
interface Props {
  code: string;
  emoji: string;
  label: string;
  weight: string;
  comment: string;
  closes60: number[];
  ma50: (number | null)[];
  ma200: (number | null)[];
}
const { code, emoji, label, weight, comment, closes60, ma50, ma200 } = Astro.props;

const labelColor = {
  '풀매수': 'text-emerald-400',
  '분할매수': 'text-teal-400',
  '관망/존버': 'text-amber-400',
  '비중축소+이익실현': 'text-red-400',
}[label] ?? 'text-slate-300';
---
<article class="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
  <header class="flex items-center justify-between">
    <h3 class="text-base font-semibold flex items-center gap-2"><span aria-hidden="true">{emoji}</span>{code}</h3>
    <span class={`text-sm font-semibold ${labelColor}`}>{label} · {weight}</span>
  </header>
  <IndexChart closes={closes60} ma50={ma50} ma200={ma200} />
  <p class="text-sm text-slate-200 leading-relaxed">{comment}</p>
</article>
```

- [ ] **Step 3: Write `src/components/OverallCard.astro`**

```astro
---
interface Props {
  weight: string;
  comment: string;
}
const { weight, comment } = Astro.props;
---
<article class="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 p-5 space-y-2">
  <header class="flex items-center gap-2">
    <span aria-hidden="true" class="text-lg">💡</span>
    <h3 class="text-sm uppercase tracking-wider text-slate-300">종합 권장 비중</h3>
  </header>
  <p class="text-2xl font-bold text-brand-mood">{weight}</p>
  <p class="text-sm text-slate-200 leading-relaxed">{comment}</p>
</article>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/FearGaugeCard.astro src/components/MarketMoodCard.astro src/components/OverallCard.astro
git commit -m "feat(ui): fear gauge, market mood, overall cards"
```

---

## Task 16: Client-side toggle script

**Files:**
- Create: `src/scripts/toggle.ts`

- [ ] **Step 1: Write `src/scripts/toggle.ts`**

```ts
// Toggle reveal of #section-picks / #section-mood when matching button clicked.
// Only one section open at a time. Second click on same button closes it.

function init() {
  const buttons = document.querySelectorAll<HTMLButtonElement>('button.action-btn[data-target]');
  const sections = new Map<string, HTMLElement>();

  buttons.forEach((btn) => {
    const target = btn.dataset.target!;
    const sec = document.getElementById(`section-${target}`);
    if (sec) sections.set(target, sec);
  });

  function close(target: string) {
    const sec = sections.get(target);
    if (!sec) return;
    sec.hidden = true;
    const btn = document.querySelector<HTMLButtonElement>(`button.action-btn[data-target="${target}"]`);
    btn?.setAttribute('aria-expanded', 'false');
  }

  function open(target: string) {
    sections.forEach((_, key) => {
      if (key !== target) close(key);
    });
    const sec = sections.get(target);
    if (!sec) return;
    sec.hidden = false;
    const btn = document.querySelector<HTMLButtonElement>(`button.action-btn[data-target="${target}"]`);
    btn?.setAttribute('aria-expanded', 'true');
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target!;
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      if (expanded) close(target);
      else open(target);
    });
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
git add src/scripts/toggle.ts
git commit -m "feat(ui): client-side toggle script for action buttons"
```

---

## Task 17: Wire `index.astro`

**Files:**
- Modify: `src/pages/index.astro` (overwrite placeholder)

- [ ] **Step 1: Overwrite `src/pages/index.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import ActionButton from '../components/ActionButton.astro';
import PickCard from '../components/PickCard.astro';
import FearGaugeCard from '../components/FearGaugeCard.astro';
import MarketMoodCard from '../components/MarketMoodCard.astro';
import OverallCard from '../components/OverallCard.astro';
import picksData from '../data/picks.json';
import regimeData from '../data/regime.json';

const { kr = [], us = [], asOf: picksAsOf } = picksData;
const { fearGauge, markets = [], overall, asOf: regimeAsOf } = regimeData;
const asOf = regimeAsOf ?? picksAsOf;
---
<Base title="surgePick — 급등픽 & 시장 온도계" asOf={asOf}>
  <div class="space-y-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0 mb-6">
    <ActionButton target="picks" label="오늘의 급등픽" icon="📈" color="pick" />
    <ActionButton target="mood"  label="지금 시장 어때?" icon="🌡️" color="mood" />
  </div>

  <section id="section-picks" hidden class="space-y-6">
    <div class="space-y-3">
      <h2 class="text-sm uppercase tracking-wider text-slate-400">🇰🇷 한국</h2>
      {kr.length > 0 ? (
        kr.map((p) => <PickCard {...p} />)
      ) : (
        <p class="text-sm text-slate-400 text-center py-4">오늘은 조건 충족 종목 없음. 내일 다시 확인.</p>
      )}
    </div>
    <div class="space-y-3">
      <h2 class="text-sm uppercase tracking-wider text-slate-400">🇺🇸 미국</h2>
      {us.length > 0 ? (
        us.map((p) => <PickCard {...p} />)
      ) : (
        <p class="text-sm text-slate-400 text-center py-4">오늘은 조건 충족 종목 없음. 내일 다시 확인.</p>
      )}
    </div>
  </section>

  <section id="section-mood" hidden class="space-y-4">
    <FearGaugeCard {...fearGauge} />
    {markets.map((m) => <MarketMoodCard {...m} />)}
    <OverallCard {...overall} />
  </section>

  <script>
    import '../scripts/toggle.ts';
  </script>
</Base>
```

- [ ] **Step 2: Run dev server and verify**

```bash
npm run dev
```

Open `http://localhost:4321`. Verify on mobile viewport (Chrome DevTools, 375×667):
- Two big buttons stacked vertically.
- Click `오늘의 급등픽` → picks section appears with KR + US groups.
- Click again → closes.
- Click `지금 시장 어때?` → fear gauge + 4 markets + overall card. Previous section auto-closes.
- Tap targets ≥ 64px height.
- asOf timestamp visible in header.
- Footer disclaimer visible.

Capture mobile screenshot of both states for the commit message.

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: build succeeds, output in `.vercel/output/static/`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(ui): wire single page with picks + mood sections and toggle"
```

---

## Task 20: Theme aggregate (`theme-aggregate.mjs`) — TDD

**Files:**
- Create: `scripts/lib/theme-aggregate.mjs`
- Create: `tests/theme-aggregate.test.mjs`
- Create: `tests/fixtures/theme-basket.json`

Aggregates multiple stock series into a single theme index. Each stock's closes are normalized to 100 on day 0, then averaged across constituents. Stocks with missing data are dropped from that day's average.

- [ ] **Step 1: Write fixture**

`tests/fixtures/theme-basket.json` — 3 stocks, 5 days each, mixed prices:

```json
{
  "stocks": [
    { "ticker": "A", "closes": [100, 102, 104, 103, 105] },
    { "ticker": "B", "closes": [50,  51,  52,  53,  55]  },
    { "ticker": "C", "closes": [200, 198, 202, 205, 210] }
  ]
}
```

Expected aggregate (each normalized to 100 on day 0, then mean):
- Day 0: (100 + 100 + 100) / 3 = 100
- Day 1: (102 + 102 + 99)  / 3 = 101
- Day 2: (104 + 104 + 101) / 3 = 103
- Day 3: (103 + 106 + 102.5) / 3 = 103.83…
- Day 4: (105 + 110 + 105) / 3 = 106.66…

- [ ] **Step 2: Write failing test**

`tests/theme-aggregate.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateTheme } from '../scripts/lib/theme-aggregate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fix = JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'theme-basket.json'), 'utf8'));

describe('aggregateTheme', () => {
  it('returns array same length as longest input', () => {
    const r = aggregateTheme(fix.stocks);
    expect(r.length).toBe(5);
  });

  it('starts at 100 (normalized)', () => {
    const r = aggregateTheme(fix.stocks);
    expect(r[0]).toBeCloseTo(100, 5);
  });

  it('day-1 average matches manual calc', () => {
    const r = aggregateTheme(fix.stocks);
    expect(r[1]).toBeCloseTo(101, 1);
  });

  it('ignores stocks with missing data for a given day', () => {
    const stocks = [
      { ticker: 'A', closes: [100, 110, 120] },
      { ticker: 'B', closes: [50,  null, 60] },
    ];
    const r = aggregateTheme(stocks);
    // day 1: only A → 110
    expect(r[1]).toBeCloseTo(110, 1);
  });

  it('returns empty array when no stocks have data', () => {
    expect(aggregateTheme([])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to confirm fail**

```bash
npm test -- theme-aggregate
```

Expected: FAIL.

- [ ] **Step 4: Implement `scripts/lib/theme-aggregate.mjs`**

```js
/**
 * Aggregate multiple stock close-series into a single normalized theme index.
 * Each stock is normalized to 100 on its first valid day, then averaged daily.
 * Days where a stock has null/undefined are dropped from that day's mean.
 *
 * Input:  [{ ticker, closes: (number|null)[] }, ...]
 * Output: number[]
 */
export function aggregateTheme(stocks) {
  if (stocks.length === 0) return [];
  const maxLen = Math.max(...stocks.map((s) => s.closes.length));
  if (maxLen === 0) return [];

  // Normalize: closes[i] / closes[0] * 100, where closes[0] is first non-null.
  const normalized = stocks.map((s) => {
    const base = s.closes.find((c) => c != null);
    if (base == null || base === 0) return s.closes.map(() => null);
    return s.closes.map((c) => (c == null ? null : (c / base) * 100));
  });

  const out = [];
  for (let i = 0; i < maxLen; i++) {
    const vals = normalized.map((n) => n[i]).filter((v) => v != null);
    if (vals.length === 0) out.push(null);
    else out.push(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return out;
}
```

- [ ] **Step 5: Run to confirm pass**

```bash
npm test -- theme-aggregate
```

Expected: PASS — 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/theme-aggregate.mjs tests/theme-aggregate.test.mjs tests/fixtures/theme-basket.json
git commit -m "feat(theme-aggregate): normalized average index from constituents"
```

---

## Task 21: Theme selector (`theme-select.mjs`) — TDD

**Files:**
- Create: `scripts/lib/theme-select.mjs`
- Create: `tests/theme-select.test.mjs`

Selects 8 popular + 8 value themes per market from a larger pool based on scored metrics.

- [ ] **Step 1: Write failing test**

`tests/theme-select.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { selectThemes } from '../scripts/lib/theme-select.mjs';

const sample = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    name: `theme${i}`,
    score: ((i * 7) % 9) - 4,           // -4 .. +4
    mom1m: ((i % 10) - 5) / 100,        // -0.05 .. +0.05
    mom3m: ((i % 7) - 3) / 100,         // -0.03 .. +0.03
    vol20: 0.10 + (i % 5) * 0.05,       // 0.10 .. 0.30
  }));

describe('selectThemes', () => {
  it('returns 8 popular + 8 value when pool has enough', () => {
    const { popular, value } = selectThemes(sample(30));
    expect(popular.length).toBe(8);
    expect(value.length).toBe(8);
  });

  it('popular sorted by momentum (mom1m*0.4 + mom3m*0.6) descending', () => {
    const { popular } = selectThemes(sample(20));
    const moms = popular.map((t) => t.mom1m * 0.4 + t.mom3m * 0.6);
    for (let i = 1; i < moms.length; i++) {
      expect(moms[i]).toBeLessThanOrEqual(moms[i - 1]);
    }
  });

  it('value filtered by score>=1 AND vol20<0.25 AND mom3m>-0.05', () => {
    const { value } = selectThemes(sample(30));
    for (const t of value) {
      expect(t.score).toBeGreaterThanOrEqual(1);
      expect(t.vol20).toBeLessThan(0.25);
      expect(t.mom3m).toBeGreaterThan(-0.05);
    }
  });

  it('no overlap between popular and value', () => {
    const { popular, value } = selectThemes(sample(30));
    const popIds = new Set(popular.map((t) => t.id));
    for (const v of value) {
      expect(popIds.has(v.id)).toBe(false);
    }
  });

  it('returns shorter lists when pool is small', () => {
    const { popular, value } = selectThemes(sample(5));
    expect(popular.length).toBeLessThanOrEqual(5);
    expect(value.length + popular.length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test -- theme-select
```

Expected: FAIL.

- [ ] **Step 3: Implement `scripts/lib/theme-select.mjs`**

```js
/**
 * Select daily themes from a scored pool.
 * Input: pool = [{ id, name, score, mom1m, mom3m, vol20, ... }, ...]
 * Output: { popular: [...], value: [...] } — non-overlapping, up to 8 each.
 */
export function selectThemes(pool) {
  const byMomentum = [...pool]
    .map((t) => ({ ...t, _mom: t.mom1m * 0.4 + t.mom3m * 0.6 }))
    .sort((a, b) => b._mom - a._mom);

  const popular = byMomentum.slice(0, 8).map(({ _mom, ...t }) => t);
  const popularIds = new Set(popular.map((t) => t.id));

  const valueCandidates = pool
    .filter((t) =>
      t.score >= 1 &&
      t.vol20 < 0.25 &&
      t.mom3m > -0.05 &&
      !popularIds.has(t.id)
    )
    .sort((a, b) => b.score - a.score);

  const value = valueCandidates.slice(0, 8);

  return { popular, value };
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
npm test -- theme-select
```

Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/theme-select.mjs tests/theme-select.test.mjs
git commit -m "feat(theme-select): daily popular+value picker from scored pool"
```

---

## Task 22: Theme master pool data

**Files:**
- Create: `scripts/themes-kr.json`
- Create: `scripts/themes-us.json`

Master pool of 30+ themes per market. Each theme has 5–8 representative tickers. Categories listed are hints — actual classification is decided daily by Task 21.

- [ ] **Step 1: Write `scripts/themes-kr.json`**

```json
[
  { "id": "semis-kr", "name": "반도체", "icon": "🧠", "tickers": ["005930.KS","000660.KS","042700.KS","166090.KQ","240810.KQ","039030.KQ"] },
  { "id": "battery-kr", "name": "2차전지", "icon": "🔋", "tickers": ["373220.KS","006400.KS","051910.KS","247540.KQ","066970.KQ","003670.KS"] },
  { "id": "ai-kr", "name": "AI", "icon": "🤖", "tickers": ["035420.KS","035720.KS","018260.KS","108860.KQ","402030.KQ","095340.KQ"] },
  { "id": "bio-kr", "name": "바이오", "icon": "🧬", "tickers": ["207940.KS","068270.KS","091990.KQ","196170.KQ","298380.KQ","326030.KS"] },
  { "id": "ent-kr", "name": "K-pop·엔터", "icon": "🎤", "tickers": ["352820.KS","035900.KQ","041510.KQ","182360.KQ","263750.KQ"] },
  { "id": "defense-kr", "name": "방산", "icon": "🛡️", "tickers": ["012450.KS","047810.KS","064350.KS","272210.KS"] },
  { "id": "nuclear-kr", "name": "원전", "icon": "⚛️", "tickers": ["034020.KS","015760.KS","267260.KS","064350.KS"] },
  { "id": "robot-kr", "name": "로봇", "icon": "🦾", "tickers": ["060280.KQ","108490.KQ","056080.KQ","023900.KQ"] },
  { "id": "bank-kr", "name": "은행·금융", "icon": "🏦", "tickers": ["105560.KS","055550.KS","086790.KS","316140.KS","138930.KS","024110.KS"] },
  { "id": "insurance-kr", "name": "보험", "icon": "🛟", "tickers": ["032830.KS","000810.KS","005830.KS","088350.KS"] },
  { "id": "telco-kr", "name": "통신", "icon": "📡", "tickers": ["017670.KS","030200.KS","032640.KS"] },
  { "id": "food-kr", "name": "식품·음식료", "icon": "🍱", "tickers": ["097950.KS","271560.KS","139480.KS","004370.KS","004990.KS"] },
  { "id": "utility-kr", "name": "유틸리티", "icon": "⚡", "tickers": ["015760.KS","036460.KS","034020.KS"] },
  { "id": "construction-kr", "name": "건설", "icon": "🏗️", "tickers": ["000720.KS","028050.KS","006360.KS","047040.KS"] },
  { "id": "auto-kr", "name": "자동차", "icon": "🚗", "tickers": ["005380.KS","000270.KS","012330.KS","086280.KS"] },
  { "id": "chemical-kr", "name": "화학", "icon": "⚗️", "tickers": ["051910.KS","011170.KS","010950.KS","298050.KS"] },
  { "id": "shipping-kr", "name": "해운·물류", "icon": "🚢", "tickers": ["011200.KS","000120.KS","028670.KS","086280.KS"] },
  { "id": "shipbuild-kr", "name": "조선", "icon": "⚓", "tickers": ["009540.KS","010620.KS","042660.KS","329180.KS"] },
  { "id": "steel-kr", "name": "철강·소재", "icon": "🔩", "tickers": ["005490.KS","004020.KS","014530.KS","003030.KS"] },
  { "id": "retail-kr", "name": "유통·소비", "icon": "🛒", "tickers": ["139480.KS","023530.KS","004170.KS","006800.KS"] },
  { "id": "game-kr", "name": "게임", "icon": "🎮", "tickers": ["036570.KS","112040.KQ","293490.KQ","263750.KQ","192080.KQ","078340.KQ"] },
  { "id": "beauty-kr", "name": "화장품·미용", "icon": "💄", "tickers": ["090430.KS","214150.KQ","145020.KQ","086900.KQ","950140.KQ"] },
  { "id": "media-kr", "name": "미디어·콘텐츠", "icon": "🎬", "tickers": ["035720.KS","035420.KS","067160.KQ","079160.KS"] },
  { "id": "ev-kr", "name": "친환경차·EV", "icon": "🔌", "tickers": ["005380.KS","000270.KS","373220.KS","006400.KS"] },
  { "id": "energy-kr", "name": "신재생에너지", "icon": "☀️", "tickers": ["009830.KS","267260.KS","034020.KS","298050.KS"] },
  { "id": "reit-kr", "name": "리츠·부동산", "icon": "🏢", "tickers": ["330590.KS","350520.KS","357250.KS","404990.KS"] },
  { "id": "metal-kr", "name": "비철금속", "icon": "🥈", "tickers": ["010130.KS","005490.KS","014530.KS"] },
  { "id": "logistics-kr", "name": "유통·물류", "icon": "📦", "tickers": ["000120.KS","086280.KS","028670.KS"] },
  { "id": "tour-kr", "name": "여행·항공", "icon": "✈️", "tickers": ["003490.KS","020560.KS","003495.KS","180640.KS"] },
  { "id": "fintech-kr", "name": "핀테크", "icon": "💳", "tickers": ["377300.KQ","035720.KS","035420.KS"] },
  { "id": "space-kr", "name": "우주항공", "icon": "🚀", "tickers": ["047810.KS","064350.KS","012450.KS"] }
]
```

- [ ] **Step 2: Write `scripts/themes-us.json`**

```json
[
  { "id": "ai-us", "name": "AI", "icon": "🤖", "tickers": ["NVDA","MSFT","GOOGL","META","AMZN","PLTR"] },
  { "id": "semis-us", "name": "반도체", "icon": "🧠", "tickers": ["NVDA","AVGO","AMD","INTC","TXN","QCOM","MU","LRCX","AMAT","ADI"] },
  { "id": "ev-us", "name": "EV", "icon": "🔌", "tickers": ["TSLA","RIVN","LCID","NIO","XPEV","F","GM"] },
  { "id": "cloud-us", "name": "클라우드", "icon": "☁️", "tickers": ["MSFT","AMZN","GOOGL","CRM","NOW","ORCL","SNOW"] },
  { "id": "cyber-us", "name": "사이버보안", "icon": "🛡️", "tickers": ["PANW","CRWD","FTNT","ZS","S","NET"] },
  { "id": "quantum-us", "name": "양자컴퓨팅", "icon": "🌀", "tickers": ["IBM","GOOGL","IONQ","RGTI","QBTS"] },
  { "id": "space-us", "name": "우주항공", "icon": "🚀", "tickers": ["BA","RTX","LMT","NOC","GD","RKLB","LHX"] },
  { "id": "glp1-us", "name": "GLP-1·비만", "icon": "💊", "tickers": ["LLY","NVO","PFE","AMGN"] },
  { "id": "bigbank-us", "name": "빅뱅크", "icon": "🏦", "tickers": ["JPM","BAC","WFC","C","GS","MS"] },
  { "id": "reit-us", "name": "REIT", "icon": "🏢", "tickers": ["PLD","EQIX","AMT","CCI","WELL","SPG"] },
  { "id": "utility-us", "name": "유틸리티", "icon": "⚡", "tickers": ["NEE","SO","DUK","AEP","EXC","SRE"] },
  { "id": "health-us", "name": "헬스케어", "icon": "🏥", "tickers": ["JNJ","UNH","ABBV","MRK","PFE","LLY","TMO","ABT"] },
  { "id": "consumer-us", "name": "필수소비재", "icon": "🛒", "tickers": ["PG","KO","PEP","WMT","COST","CL","MDLZ"] },
  { "id": "energy-us", "name": "에너지", "icon": "🛢️", "tickers": ["XOM","CVX","COP","SLB","EOG","PSX"] },
  { "id": "industrial-us", "name": "산업재", "icon": "🏭", "tickers": ["GE","HON","CAT","DE","ETN","UPS","RTX"] },
  { "id": "telco-us", "name": "통신", "icon": "📡", "tickers": ["VZ","T","TMUS","CMCSA"] },
  { "id": "biotech-us", "name": "바이오테크", "icon": "🧬", "tickers": ["GILD","VRTX","REGN","BIIB","AMGN","MRNA"] },
  { "id": "fintech-us", "name": "핀테크", "icon": "💳", "tickers": ["V","MA","PYPL","SQ","COIN","FI"] },
  { "id": "ecom-us", "name": "이커머스", "icon": "🛍️", "tickers": ["AMZN","SHOP","MELI","EBAY","ETSY"] },
  { "id": "stream-us", "name": "스트리밍·엔터", "icon": "🎬", "tickers": ["NFLX","DIS","SPOT","ROKU","WBD"] },
  { "id": "game-us", "name": "게임", "icon": "🎮", "tickers": ["EA","TTWO","RBLX","U"] },
  { "id": "social-us", "name": "소셜·광고", "icon": "📱", "tickers": ["META","SNAP","PINS","GOOGL"] },
  { "id": "auto-us", "name": "자동차", "icon": "🚗", "tickers": ["TSLA","F","GM","TM","STLA"] },
  { "id": "renewable-us", "name": "신재생에너지", "icon": "☀️", "tickers": ["NEE","ENPH","FSLR","SEDG","RUN"] },
  { "id": "uranium-us", "name": "원자력", "icon": "⚛️", "tickers": ["CCJ","BWXT","SMR","OKLO","NEE"] },
  { "id": "metals-us", "name": "원자재·금속", "icon": "⛏️", "tickers": ["FCX","NEM","GOLD","SCCO","X"] },
  { "id": "ai-infra-us", "name": "AI 인프라", "icon": "🏗️", "tickers": ["NVDA","AVGO","MU","SMCI","ANET","VRT"] },
  { "id": "defense-us", "name": "방산", "icon": "🪖", "tickers": ["LMT","RTX","NOC","GD","BA","LHX","TDG"] },
  { "id": "tobacco-us", "name": "담배", "icon": "🚬", "tickers": ["PM","MO","BTI"] },
  { "id": "retail-disc-us", "name": "임의소비재", "icon": "🛍️", "tickers": ["AMZN","HD","LOW","TJX","NKE","MCD","SBUX"] }
]
```

- [ ] **Step 3: Commit**

```bash
git add scripts/themes-kr.json scripts/themes-us.json
git commit -m "data: theme master pool (30+ themes per market)"
```

---

## Task 23: Theme scanner (`scan-themes.mjs`)

**Files:**
- Create: `scripts/scan-themes.mjs`

Fetches each theme's constituent stocks, aggregates into a theme index, runs `scoreRegime`, then uses `theme-select` to surface 8 popular + 8 value per market. Reuses VIX from regime scan if available.

- [ ] **Step 1: Add to `package.json` scripts**

Modify `package.json`:

```json
"scan:themes": "node scripts/scan-themes.mjs",
"scan": "npm run scan:regime && npm run scan:themes && npm run scan:picks"
```

- [ ] **Step 2: Implement `scripts/scan-themes.mjs`**

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChart } from './fetch-yahoo.mjs';
import { aggregateTheme } from './lib/theme-aggregate.mjs';
import { scoreRegime, labelFromScore } from './lib/regime.mjs';
import { selectThemes } from './lib/theme-select.mjs';
import { marketComment } from './lib/market-comment.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '../src/data/themes.json');

function load(name) {
  return JSON.parse(readFileSync(resolve(__dirname, name), 'utf8'));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function themeOneLiner({ name, mom1m, score, vol20 }) {
  const pct = (mom1m * 100).toFixed(1);
  const sign = mom1m >= 0 ? '+' : '';
  if (score >= 3)   return `${name}: 한 달 ${sign}${pct}%, 추세 강함. 적극 비중.`;
  if (score >= 1)   return `${name}: 한 달 ${sign}${pct}%, 추세 양호. 분할매수.`;
  if (score >= -1)  return `${name}: 한 달 ${sign}${pct}%, 방향 애매. 관망.`;
  return `${name}: 한 달 ${sign}${pct}%, 약세. 일부 현금화.`;
}

async function fetchTheme(theme, cache) {
  const stocks = [];
  for (const ticker of theme.tickers) {
    let data = cache.get(ticker);
    if (data === undefined) {
      data = await fetchChart(ticker, '1y');
      cache.set(ticker, data);
      await sleep(200);
    }
    if (data) stocks.push({ ticker, closes: data.closes });
  }
  return stocks;
}

async function scanMarket(pool, market, vix) {
  console.log(`[scan-themes] ${market}: scoring ${pool.length} themes...`);
  const cache = new Map();
  const scored = [];

  for (const theme of pool) {
    const stocks = await fetchTheme(theme, cache);
    if (stocks.length === 0) continue;
    const aggregate = aggregateTheme(stocks).filter((v) => v != null);
    if (aggregate.length < 64) continue;

    const r = scoreRegime({ closes: aggregate, vix: market === 'US' ? vix : null, market });
    const { label, weight } = labelFromScore(r.score);
    scored.push({
      id: theme.id,
      name: theme.name,
      icon: theme.icon,
      score: r.score,
      mom1m: r.metrics.mom1m,
      mom3m: r.metrics.mom3m,
      vol20: r.metrics.vol20,
      label,
      weight,
      comment: themeOneLiner({ name: theme.name, mom1m: r.metrics.mom1m, score: r.score, vol20: r.metrics.vol20 }),
      closes60: aggregate.slice(-60),
      tickers: theme.tickers,
    });
  }

  return selectThemes(scored);
}

async function main() {
  const krPool = load('themes-kr.json');
  const usPool = load('themes-us.json');

  // Read VIX from regime.json if it exists, else fetch fresh.
  let vix = null;
  try {
    const regime = JSON.parse(readFileSync(resolve(__dirname, '../src/data/regime.json'), 'utf8'));
    vix = regime.fearGauge?.vix ?? null;
  } catch {
    const vixData = await fetchChart('^VIX', '1mo');
    vix = vixData?.closes?.[vixData.closes.length - 1] ?? null;
  }
  console.log(`[scan-themes] using VIX=${vix}`);

  const kr = await scanMarket(krPool, 'KR', vix);
  const us = await scanMarket(usPool, 'US', vix);

  const out = {
    asOf: new Date().toISOString(),
    kr,
    us,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`[scan-themes] wrote ${OUTPUT} — KR pop ${kr.popular.length} val ${kr.value.length} / US pop ${us.popular.length} val ${us.value.length}`);
}

main().catch((err) => {
  console.error('[scan-themes] failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Run scanner**

```bash
npm run scan:themes
```

Expected: completes in 5–10 minutes (each theme has 5–10 stocks; cache deduplicates overlap; total unique tickers ≤ ~200). `src/data/themes.json` exists.

- [ ] **Step 4: Verify shape**

```bash
node -e "const j = JSON.parse(require('fs').readFileSync('src/data/themes.json')); console.log('KR pop:', j.kr.popular.map(t=>t.name).join(',')); console.log('KR val:', j.kr.value.map(t=>t.name).join(',')); console.log('US pop:', j.us.popular.map(t=>t.name).join(',')); console.log('US val:', j.us.value.map(t=>t.name).join(','))"
```

Expected: 4 lines, each listing ≤ 8 theme names.

- [ ] **Step 5: Commit**

```bash
git add scripts/scan-themes.mjs src/data/themes.json package.json
git commit -m "feat(scanner): theme scanner with daily popular+value selection"
```

---

## Task 24: IndexChart component

**Files:**
- Create: `src/components/IndexChart.astro`

A small SVG chart showing 60d index closes plus MA50/MA200 overlays. Used inside each `MarketMoodCard`.

- [ ] **Step 1: Write `src/components/IndexChart.astro`**

```astro
---
interface Props {
  closes: number[];
  ma50: (number | null)[];
  ma200: (number | null)[];
  width?: number;
  height?: number;
  colorPrice?: string;
  colorMA50?: string;
  colorMA200?: string;
}
const {
  closes,
  ma50,
  ma200,
  width = 320,
  height = 80,
  colorPrice = '#60a5fa',
  colorMA50 = '#fbbf24',
  colorMA200 = '#94a3b8',
} = Astro.props;

// Combine all non-null values to compute y range.
const all = [
  ...closes,
  ...ma50.filter((v) => v != null),
  ...ma200.filter((v) => v != null),
];
const min = Math.min(...all);
const max = Math.max(...all);
const range = max - min || 1;
const stepX = width / Math.max(closes.length - 1, 1);

function toPoints(values) {
  return values
    .map((v, i) => {
      if (v == null) return null;
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');
}

const pricePoints = toPoints(closes);
const ma50Points = toPoints(ma50);
const ma200Points = toPoints(ma200);

const last = closes[closes.length - 1];
const lastX = (closes.length - 1) * stepX;
const lastY = height - ((last - min) / range) * height;

const gradId = `g${Math.random().toString(36).slice(2, 8)}`;
const areaPath = `M0,${height} L${pricePoints.replace(/ /g, ' L')} L${width},${height} Z`;
---
<svg viewBox={`0 0 ${width} ${height + 8}`} preserveAspectRatio="none" class="w-full h-[80px]" aria-hidden="true">
  <defs>
    <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color={colorPrice} stop-opacity="0.35" />
      <stop offset="100%" stop-color={colorPrice} stop-opacity="0" />
    </linearGradient>
  </defs>
  {ma200Points && (
    <polyline points={ma200Points} fill="none" stroke={colorMA200} stroke-width="1" stroke-linejoin="round" opacity="0.7" />
  )}
  {ma50Points && (
    <polyline points={ma50Points} fill="none" stroke={colorMA50} stroke-width="1" stroke-linejoin="round" stroke-dasharray="3 3" opacity="0.85" />
  )}
  <path d={areaPath} fill={`url(#${gradId})`} />
  <polyline points={pricePoints} fill="none" stroke={colorPrice} stroke-width="1.5" stroke-linejoin="round" />
  <circle cx={lastX} cy={lastY} r="3" fill={colorPrice} />
</svg>
<div class="flex gap-3 text-[10px] text-slate-500 mt-1">
  <span class="flex items-center gap-1"><span class="inline-block w-3 h-[2px]" style={`background:${colorPrice}`}></span>지수</span>
  <span class="flex items-center gap-1"><span class="inline-block w-3 h-[2px]" style={`background:${colorMA50};border-bottom:1px dashed ${colorMA50}`}></span>MA50</span>
  <span class="flex items-center gap-1"><span class="inline-block w-3 h-[2px]" style={`background:${colorMA200}`}></span>MA200</span>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/IndexChart.astro
git commit -m "feat(ui): IndexChart with MA50/MA200 overlay"
```

---

## Task 25: ThemeCard + ThemeCarousel components

**Files:**
- Create: `src/components/ThemeCard.astro`
- Create: `src/components/ThemeCarousel.astro`

- [ ] **Step 1: Write `src/components/ThemeCard.astro`**

```astro
---
import Sparkline from './Sparkline.astro';
interface Props {
  id: string;
  name: string;
  icon: string;
  label: string;
  weight: string;
  comment: string;
  closes60: number[];
  variant: 'popular' | 'value';
}
const { name, icon, label, weight, comment, closes60, variant } = Astro.props;

const accent = variant === 'popular' ? 'border-l-orange-500' : 'border-l-teal-500';
const labelColor = {
  '풀매수': 'text-emerald-400',
  '분할매수': 'text-teal-400',
  '관망/존버': 'text-amber-400',
  '비중축소+이익실현': 'text-red-400',
}[label] ?? 'text-slate-300';
const lineColor = variant === 'popular' ? '#fb923c' : '#2dd4bf';
---
<article class={`shrink-0 w-[44vw] sm:w-[180px] rounded-2xl bg-slate-900 border border-slate-800 border-l-4 ${accent} p-3 space-y-2 snap-start`}>
  <header class="flex items-center gap-2">
    <span class="text-base" aria-hidden="true">{icon}</span>
    <h4 class="text-sm font-semibold truncate">{name}</h4>
  </header>
  <Sparkline values={closes60.slice(-30)} color={lineColor} height={32} />
  <div class={`text-[11px] font-semibold ${labelColor}`}>{label} · {weight}</div>
  <p class="text-[11px] text-slate-300 leading-snug line-clamp-2">{comment}</p>
</article>
```

Note: requires `@tailwindcss/line-clamp` plugin or Tailwind 3.3+ which bundles it. Already on 3.4.17 so `line-clamp-2` works out of the box.

- [ ] **Step 2: Write `src/components/ThemeCarousel.astro`**

```astro
---
import ThemeCard from './ThemeCard.astro';
interface Props {
  items: Array<{ id: string; name: string; icon: string; label: string; weight: string; comment: string; closes60: number[] }>;
  variant: 'popular' | 'value';
  ariaLabel: string;
}
const { items, variant, ariaLabel } = Astro.props;
---
<div
  class="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 scroll-smooth scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700"
  role="region"
  aria-label={ariaLabel}
>
  {items.map((t) => <ThemeCard {...t} variant={variant} />)}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ThemeCard.astro src/components/ThemeCarousel.astro
git commit -m "feat(ui): ThemeCard + horizontal scroll-snap carousel"
```

---

## Task 26: ThemeTabs component + tab switcher script

**Files:**
- Create: `src/components/ThemeTabs.astro`
- Create: `src/scripts/theme-tabs.ts`

- [ ] **Step 1: Write `src/components/ThemeTabs.astro`**

```astro
---
interface Props {
  groupId: string;  // 'kr' | 'us'
}
const { groupId } = Astro.props;
---
<div class="theme-tabs flex gap-1 mb-3" data-group={groupId} role="tablist">
  <button
    type="button"
    class="theme-tab flex-1 py-2 rounded-lg text-sm font-medium transition-colors bg-orange-500 text-white"
    data-tab="popular"
    role="tab"
    aria-selected="true"
  >🔥 인기</button>
  <button
    type="button"
    class="theme-tab flex-1 py-2 rounded-lg text-sm font-medium transition-colors bg-slate-800 text-slate-300"
    data-tab="value"
    role="tab"
    aria-selected="false"
  >💎 투자가치</button>
</div>
```

- [ ] **Step 2: Write `src/scripts/theme-tabs.ts`**

```ts
// Switch between [인기] / [투자가치] within each market group (KR/US).
// Each group has two carousels: data-pane="popular" and data-pane="value".
// Active tab styling: orange for popular, teal for value.

const ACTIVE_BG = { popular: 'bg-orange-500', value: 'bg-teal-500' } as const;

function init() {
  document.querySelectorAll<HTMLElement>('.theme-tabs[data-group]').forEach((tabs) => {
    const group = tabs.dataset.group!;
    const panes = document.querySelectorAll<HTMLElement>(`[data-pane-group="${group}"]`);

    tabs.querySelectorAll<HTMLButtonElement>('.theme-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const variant = btn.dataset.tab as 'popular' | 'value';

        tabs.querySelectorAll<HTMLButtonElement>('.theme-tab').forEach((b) => {
          const isActive = b === btn;
          b.setAttribute('aria-selected', String(isActive));
          b.classList.remove('bg-orange-500', 'bg-teal-500', 'bg-slate-800', 'text-white', 'text-slate-300');
          if (isActive) {
            b.classList.add(ACTIVE_BG[b.dataset.tab as 'popular' | 'value'], 'text-white');
          } else {
            b.classList.add('bg-slate-800', 'text-slate-300');
          }
        });

        panes.forEach((pane) => {
          pane.hidden = pane.dataset.pane !== variant;
        });
      });
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ThemeTabs.astro src/scripts/theme-tabs.ts
git commit -m "feat(ui): theme tabs (popular/value) + switcher script"
```

---

## Task 27: Wire themes into `index.astro`

**Files:**
- Modify: `src/pages/index.astro`

Update the `index.astro` from Task 17 to render the theme section after the OverallCard inside `#section-mood`.

- [ ] **Step 1: Replace `src/pages/index.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import ActionButton from '../components/ActionButton.astro';
import PickCard from '../components/PickCard.astro';
import FearGaugeCard from '../components/FearGaugeCard.astro';
import MarketMoodCard from '../components/MarketMoodCard.astro';
import OverallCard from '../components/OverallCard.astro';
import ThemeTabs from '../components/ThemeTabs.astro';
import ThemeCarousel from '../components/ThemeCarousel.astro';
import picksData from '../data/picks.json';
import regimeData from '../data/regime.json';
import themesData from '../data/themes.json';

const { kr: krPicks = [], us: usPicks = [], asOf: picksAsOf } = picksData;
const { fearGauge, markets = [], overall, asOf: regimeAsOf } = regimeData;
const { kr: krThemes = { popular: [], value: [] }, us: usThemes = { popular: [], value: [] }, asOf: themesAsOf } = themesData;
const asOf = themesAsOf ?? regimeAsOf ?? picksAsOf;
---
<Base title="surgePick — 급등픽 & 시장 온도계" asOf={asOf}>
  <div class="space-y-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0 mb-6">
    <ActionButton target="picks" label="오늘의 급등픽" icon="📈" color="pick" />
    <ActionButton target="mood"  label="지금 시장 어때?" icon="🌡️" color="mood" />
  </div>

  <section id="section-picks" hidden class="space-y-6">
    <div class="space-y-3">
      <h2 class="text-sm uppercase tracking-wider text-slate-400">🇰🇷 한국</h2>
      {krPicks.length > 0
        ? krPicks.map((p) => <PickCard {...p} />)
        : <p class="text-sm text-slate-400 text-center py-4">오늘은 조건 충족 종목 없음. 내일 다시 확인.</p>}
    </div>
    <div class="space-y-3">
      <h2 class="text-sm uppercase tracking-wider text-slate-400">🇺🇸 미국</h2>
      {usPicks.length > 0
        ? usPicks.map((p) => <PickCard {...p} />)
        : <p class="text-sm text-slate-400 text-center py-4">오늘은 조건 충족 종목 없음. 내일 다시 확인.</p>}
    </div>
  </section>

  <section id="section-mood" hidden class="space-y-4">
    <FearGaugeCard {...fearGauge} />
    {markets.map((m) => <MarketMoodCard {...m} />)}
    <OverallCard {...overall} />

    <hr class="border-slate-800 my-6" />

    <h2 class="text-base font-semibold flex items-center gap-2">
      <span aria-hidden="true">📊</span>테마 분위기
    </h2>

    <div class="space-y-2">
      <h3 class="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1">🇰🇷 한국</h3>
      <ThemeTabs groupId="kr" />
      <div data-pane="popular" data-pane-group="kr">
        <ThemeCarousel items={krThemes.popular} variant="popular" ariaLabel="한국 인기 테마" />
      </div>
      <div data-pane="value" data-pane-group="kr" hidden>
        <ThemeCarousel items={krThemes.value} variant="value" ariaLabel="한국 투자가치 테마" />
      </div>
    </div>

    <div class="space-y-2">
      <h3 class="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1">🇺🇸 미국</h3>
      <ThemeTabs groupId="us" />
      <div data-pane="popular" data-pane-group="us">
        <ThemeCarousel items={usThemes.popular} variant="popular" ariaLabel="미국 인기 테마" />
      </div>
      <div data-pane="value" data-pane-group="us" hidden>
        <ThemeCarousel items={usThemes.value} variant="value" ariaLabel="미국 투자가치 테마" />
      </div>
    </div>
  </section>

  <script>
    import '../scripts/toggle.ts';
    import '../scripts/theme-tabs.ts';
  </script>
</Base>
```

- [ ] **Step 2: Run dev server**

```bash
npm run dev
```

Verify at http://localhost:4321 (mobile 375×667):
- `[지금 시장 어때?]` → fear gauge + 4 markets (each with index chart + MA lines) + overall + divider + theme section.
- Theme section: tabs `🔥 인기` / `💎 투자가치` per market group.
- Tab click → carousel content swaps.
- Horizontal swipe shows 4 cards on screen, more available by swiping.
- Active tab has colored background (orange / teal).

- [ ] **Step 3: Build production bundle**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(ui): wire theme section with tabs + carousel into mood view"
```

---

## Task 18: README + Vercel config

**Files:**
- Create: `README.md`
- Create: `public/robots.txt`

- [ ] **Step 1: Write `README.md`**

```markdown
# surgePick

Mobile-first Korean/US stock screener:
- **오늘의 급등픽** — Top 3 KR + Top 3 US stocks matching gradual-uptrend + rising-volume + bottom-accumulation pattern.
- **지금 시장 어때?** — Fear gauge (VIX) + 4-market mood (KOSPI/KOSDAQ/S&P500/NASDAQ) + recommended equity weight.

## Local

```bash
npm install
npm run scan         # fetch data → src/data/*.json (≈ 7 min)
npm run dev          # open http://localhost:4321
```

## Scripts

- `npm run scan:picks` — refresh `src/data/picks.json`
- `npm run scan:regime` — refresh `src/data/regime.json`
- `npm run scan` — both
- `npm run test` — run Vitest suite
- `npm run build` — production build

## Deploy

Vercel static. Push to `main`; Vercel rebuilds from committed JSON.

To refresh data: run `npm run scan` locally, commit the updated JSON, push.

## Disclaimer

Reference information only. Not investment advice.
```

- [ ] **Step 2: Write `public/robots.txt`**

```
User-agent: *
Allow: /
```

- [ ] **Step 3: Commit**

```bash
git add README.md public/robots.txt
git commit -m "docs: README + robots.txt"
```

---

## Task 19: Run full test suite + verify mobile/desktop

**Files:** none — verification task.

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all suites pass — stats, scoring, regime, fear-gauge, reason-template, market-comment.

- [ ] **Step 2: Run production build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Mobile viewport check**

Open `npm run preview` → http://localhost:4321 in Chrome DevTools mobile mode (iPhone 12 Pro 390×844):
- Both action buttons hit area ≥ 64px.
- Sections expand/collapse smoothly.
- All card text readable at 16px+.
- No horizontal scroll.

- [ ] **Step 4: Desktop viewport check**

Resize to 1280×800:
- Buttons sit side-by-side.
- Container max-width caps content.

- [ ] **Step 5: Final commit (if any cleanup)**

If any small fix surfaced during verification, commit it:

```bash
git add <files>
git commit -m "fix: <description>"
```

Otherwise tag the milestone:

```bash
git tag v0.1.0
```

---

## Self-Review

Coverage check against spec sections:

| Spec § | Requirement | Task |
|--------|-------------|------|
| §1 목적 | 두 버튼 모바일 사이트 | Task 13, 17 |
| §3 사용자 흐름 | 단일 페이지 토글 | Task 16, 17 |
| §4.1 스택 | Astro + Tailwind + Vercel | Task 1 |
| §4.2 디렉터리 | 매핑 | File Map |
| §5.1 유니버스 | KR + US 정적 리스트 | Task 9 |
| §5.2 페치 | Yahoo chart, 200ms 간격 | Task 8 |
| §6.1 픽 알고리즘 | 3조건 + 스코어 | Task 3 |
| §6.1 추천 이유 | 사용자 친화 템플릿 | Task 6 |
| §6.2 국면 | 4시장 점수+라벨 | Task 4 |
| §6.2 공포지수 5단계 | VIX → level | Task 5 |
| §6.2 시장 코멘트 | 라벨별 평이 문구 | Task 7 |
| §7.1 UI 단일 페이지 | 큰 버튼 + 토글 | Task 13, 16, 17 |
| §7.1 카드 디자인 | Sparkline + PickCard 등 | Task 14, 15 |
| §8.1 picks.json 스키마 | 3개 KR + 3개 US | Task 10 |
| §8.2 regime.json 스키마 | fearGauge + markets + overall | Task 11 |
| §9 에러 처리 | 페치 실패 → 종목 스킵 | Task 8, 10 |
| §10 테스트 | vitest 6개 suite | Tasks 2-7 |
| §11 면책 | 푸터 문구 + Source | Task 12 |

No placeholders. Types consistent: `closes30` used in `picks.json` (Task 10) and `PickCard` (Task 14). `fearGauge` shape matches between `fear-gauge.mjs` (Task 5), `scan-regime.mjs` (Task 11), and `FearGaugeCard` (Task 15). `markets[]` shape matches between `scan-regime.mjs`, `regime.json`, and `MarketMoodCard`. `overall.weight`/`overall.comment` consistent between `market-comment.mjs` and `OverallCard`.
