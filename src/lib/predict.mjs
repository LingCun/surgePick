/**
 * 시장 컨텍스트가 일치하는 과거 일자들을 찾아 반환.
 * case_date + horizon > today 인 일자는 오버랩 방지로 제외.
 *
 * @param {Array} regimeRows  - {date, market, label, vix_band}[]
 * @param {{market, label, vix_band}} ctx
 * @param {string} today      - 'YYYY-MM-DD'
 * @param {number} horizon    - calendar days
 * @returns {Array} 매칭된 regime row, 최신순
 */
export function matchCases(regimeRows, ctx, today, horizon) {
  const cutoff = addDays(today, -horizon);   // case_date < cutoff 면 +horizon 까지도 today 이전
  return regimeRows
    .filter(
      (r) =>
        r.market === ctx.market &&
        r.label === ctx.label &&
        // vix_band 가 nullish 면 제약 해제 (predict 의 점진 fallback 단계).
        (ctx.vix_band == null || r.vix_band === ctx.vix_band) &&
        r.date <= cutoff,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * case_date 의 close 를 기준으로 정규화된 일별 수익률 궤적.
 * @param {Array<{date:string, close:number}>} prices  - 정렬 무관
 * @param {string} caseDate
 * @param {number} horizon
 * @returns {number[]|null}  길이 horizon+1, 결측 일자는 null
 */
export function normalizeTrajectory(prices, caseDate, horizon) {
  const byDate = new Map(prices.map((p) => [p.date, p.close]));
  const c0 = byDate.get(caseDate);
  if (c0 == null) return null;
  const out = [0];
  for (let d = 1; d <= horizon; d++) {
    const target = addDays(caseDate, d);
    const c = byDate.get(target);
    out.push(c == null ? null : c / c0 - 1);
  }
  return out;
}

/**
 * 여러 trajectory 를 d 별 percentile 로 집계.
 * @param {Array<Array<number|null>>} trajectories
 * @param {number} horizon
 * @returns {Array<{d:number, p25:number, p50:number, p75:number}>}
 */
export function aggregateBands(trajectories, horizon) {
  const out = [];
  for (let d = 0; d <= horizon; d++) {
    const vals = trajectories.map((t) => t[d]).filter((v) => v != null && !Number.isNaN(v));
    vals.sort((a, b) => a - b);
    out.push({
      d,
      p25: quantile(vals, 0.25),
      p50: quantile(vals, 0.50),
      p75: quantile(vals, 0.75),
    });
  }
  return out;
}

/**
 * 최종 예측: 점진 fallback (vix_band drop → label only).
 *
 * @param {Object} args
 * @param {Array<{date:string, close:number}>} args.prices
 * @param {Array} args.regime
 * @param {{market, label, vix_band}} args.ctx
 * @param {string} args.today
 * @param {number} args.horizon
 * @returns {{
 *   forecast: Array<{d:number, date:string, median:number, lo:number, hi:number}>,
 *   case_count: number,
 *   fallback: boolean,
 *   error?: string
 * }}
 */
export function predict({ prices, regime, ctx, today, horizon }) {
  const byDate = new Map(prices.map((p) => [p.date, p.close]));
  const todayClose = byDate.get(today);
  if (todayClose == null) return { forecast: [], case_count: 0, fallback: false, error: 'no_today_close' };

  let cases = matchCases(regime, ctx, today, horizon);
  let fallback = false;
  if (cases.length < 10) {
    cases = matchCases(regime, { ...ctx, vix_band: undefined }, today, horizon)
      .filter((r) => r.market === ctx.market && r.label === ctx.label);
    fallback = true;
  }
  if (cases.length < 5) {
    return { forecast: [], case_count: cases.length, fallback, error: 'insufficient_cases' };
  }

  const trajectories = cases
    .map((c) => normalizeTrajectory(prices, c.date, horizon))
    .filter((t) => t != null);

  if (trajectories.length < 5) {
    return { forecast: [], case_count: trajectories.length, fallback, error: 'insufficient_trajectories' };
  }

  const bands = aggregateBands(trajectories, horizon);
  const forecast = bands.map((b) => ({
    d: b.d,
    date: addDays(today, b.d),
    median: todayClose * (1 + b.p50),
    lo: todayClose * (1 + b.p25),
    hi: todayClose * (1 + b.p75),
  }));

  return { forecast, case_count: trajectories.length, fallback };
}

// ---- helpers ----

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] != null) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}
