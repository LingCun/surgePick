const YAHOO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pure parser: chart-result object → { dates, opens, closes, volumes, highs, lows, meta } or null.
 * Exported for testing.
 */
export function parseChartResult(result) {
  if (!result) return null;
  const meta = result.meta ?? {};
  const q = result.indicators?.quote?.[0] ?? {};
  const ts = result.timestamp ?? [];

  const rawCloses = q.close ?? [];
  const rawOpens = q.open ?? [];
  const rawVolumes = q.volume ?? [];
  const rawHighs = q.high ?? [];
  const rawLows = q.low ?? [];

  const dates = [];
  const opens = [];
  const closes = [];
  const volumes = [];
  const highs = [];
  const lows = [];

  for (let i = 0; i < rawCloses.length; i++) {
    if (rawCloses[i] == null) continue;
    const t = ts[i];
    if (t == null) continue;
    const d = new Date(t * 1000);
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    dates.push(dateStr);
    opens.push(rawOpens[i] ?? rawCloses[i]);
    closes.push(rawCloses[i]);
    volumes.push(rawVolumes[i] ?? 0);
    highs.push(rawHighs[i] ?? rawCloses[i]);
    lows.push(rawLows[i] ?? rawCloses[i]);
  }
  if (closes.length === 0) return null;

  return {
    dates,
    opens,
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
}

/**
 * Fetch daily OHLCV from Yahoo chart endpoint.
 * range: '1mo' | '3mo' | '4mo' | '6mo' | '1y' | '2y' | '5y'
 * Returns: { dates, opens, closes, volumes, highs, lows, meta } | null
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
    return parseChartResult(data?.chart?.result?.[0]);
  } catch (e) {
    console.warn(`[fetch] failed for ${ticker}: ${e.message}`);
    return null;
  }
}

/**
 * Fetch many tickers sequentially with throttling.
 */
export async function fetchMany(tickers, { range = '4mo', delayMs = 200, progressEvery = 25 } = {}) {
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
