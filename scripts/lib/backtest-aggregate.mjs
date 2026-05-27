function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function metricsFor(entries, denomSimDays) {
  const matured = entries.filter((e) => e.status === 'matured');
  const count = matured.length;
  if (count === 0) {
    return {
      count: 0,
      winRate: null,
      meanReturn: null,
      medianReturn: null,
      pickRate: denomSimDays > 0 ? 0 : null,
    };
  }
  const rets = matured.map((e) => e.return);
  const wins = rets.filter((r) => r > 0).length;
  const mean = rets.reduce((a, b) => a + b, 0) / count;
  return {
    count,
    winRate: wins / count,
    meanReturn: mean,
    medianReturn: median(rets),
    pickRate: denomSimDays > 0 ? count / denomSimDays : null,
  };
}

function yearOf(dateStr) {
  return dateStr.slice(0, 4);
}

export function bucketize(entries, simDayCounts) {
  const overallSimDays = simDayCounts?.overall ?? 0;
  const byMarketSimDays = simDayCounts?.byMarket ?? {};
  const byYearSimDays = simDayCounts?.byYear ?? {};

  const totals = {
    ...metricsFor(entries, overallSimDays),
    active: entries.filter((e) => e.status === 'active').length,
  };

  const byMarket = {};
  for (const m of ['KR', 'US']) {
    const sub = entries.filter((e) => e.market === m);
    byMarket[m] = metricsFor(sub, byMarketSimDays[m] ?? 0);
  }

  const byHorizon = {};
  for (const h of ['단기', '중기', '장기']) {
    const sub = entries.filter((e) => e.horizon === h);
    byHorizon[h] = metricsFor(sub, overallSimDays);
  }

  const byMarketHorizon = {};
  for (const m of ['KR', 'US']) {
    for (const h of ['단기', '중기', '장기']) {
      const sub = entries.filter((e) => e.market === m && e.horizon === h);
      byMarketHorizon[`${m}-${h}`] = metricsFor(sub, byMarketSimDays[m] ?? 0);
    }
  }

  const byYear = {};
  const years = new Set([
    ...entries.map((e) => yearOf(e.buyDate)),
    ...Object.keys(byYearSimDays),
  ]);
  for (const y of [...years].sort()) {
    const sub = entries.filter((e) => yearOf(e.buyDate) === y);
    byYear[y] = metricsFor(sub, byYearSimDays[y] ?? 0);
  }

  return { totals, byMarket, byHorizon, byMarketHorizon, byYear };
}
