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
