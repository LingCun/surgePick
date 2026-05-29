import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db.mjs';
import { predict, addDays } from '../../lib/predict.mjs';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id');
  const horizon = Number(url.searchParams.get('horizon') ?? 30);
  if (!id) return jsonErr(400, 'missing_id');
  if (![30, 60, 90].includes(horizon)) return jsonErr(400, 'invalid_horizon');

  const db = getDb();

  // ticker meta
  const tk = await db.execute({
    sql: `SELECT ticker, name_kr, name_en, market, exchange FROM tickers WHERE ticker = ? LIMIT 1`,
    args: [id],
  });
  if (tk.rows.length === 0) return jsonErr(404, 'ticker_not_found');
  const ticker = tk.rows[0];

  // 과거 prices: 5년 (case 매칭용) + 표시용 최근 N일
  const pricesRes = await db.execute({
    sql: `SELECT date, open, close, high, low FROM prices WHERE ticker = ? ORDER BY date ASC`,
    args: [id],
  });
  const prices = pricesRes.rows.map((r) => ({
    date: r.date as string,
    open: r.open as number,
    close: r.close as number,
    high: r.high as number | null,
    low: r.low as number | null,
  }));
  if (prices.length === 0) return jsonErr(404, 'no_prices');

  const today = prices[prices.length - 1].date;
  const todayClose = prices[prices.length - 1].close;

  // 시장 컨텍스트 (today)
  const regNow = await db.execute({
    sql: `SELECT label, vix, vix_band FROM regime WHERE market = ? AND date <= ? ORDER BY date DESC LIMIT 1`,
    args: [ticker.market, today],
  });
  if (regNow.rows.length === 0) return jsonErr(404, 'no_regime');
  const ctx = {
    market: ticker.market as string,
    label: regNow.rows[0].label as string,
    vix_band: regNow.rows[0].vix_band as string,
  };

  // 전체 regime (case 매칭용)
  const regAll = await db.execute({
    sql: `SELECT date, market, label, vix_band FROM regime WHERE market = ? ORDER BY date ASC`,
    args: [ticker.market],
  });
  const regimeRows = regAll.rows.map((r) => ({
    date: r.date as string,
    market: r.market as string,
    label: r.label as string,
    vix_band: r.vix_band as string,
  }));

  // 예측
  const { forecast, case_count, fallback, error } = predict({
    prices,
    regime: regimeRows,
    ctx,
    today,
    horizon,
  });

  // 표시용 최근 가격: 과거 30 calendar-day 고정 (horizon 과 무관). 예측 horizon 이 시선 받게 함.
  const historyCutoff = addDays(today, -30);
  const recent = prices.filter((p) => p.date >= historyCutoff);

  return new Response(
    JSON.stringify({
      ticker,
      today_close: todayClose,
      context: { ...ctx, vix: regNow.rows[0].vix, case_count, fallback, error: error ?? null },
      history: recent,
      forecast,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
};

function jsonErr(status: number, code: string) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
