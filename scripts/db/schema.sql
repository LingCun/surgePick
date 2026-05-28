CREATE TABLE IF NOT EXISTS tickers (
  ticker    TEXT PRIMARY KEY,
  name_kr   TEXT,
  name_en   TEXT,
  market    TEXT NOT NULL,
  exchange  TEXT,
  active    INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tickers_name_kr ON tickers(name_kr);
CREATE INDEX IF NOT EXISTS idx_tickers_name_en ON tickers(name_en);
CREATE INDEX IF NOT EXISTS idx_tickers_market ON tickers(market);

CREATE TABLE IF NOT EXISTS prices (
  ticker    TEXT NOT NULL,
  date      TEXT NOT NULL,
  open      REAL NOT NULL,
  close     REAL NOT NULL,
  high      REAL,
  low       REAL,
  PRIMARY KEY (ticker, date)
);
CREATE INDEX IF NOT EXISTS idx_prices_date ON prices(date);

CREATE TABLE IF NOT EXISTS regime (
  date      TEXT NOT NULL,
  market    TEXT NOT NULL,
  label     TEXT NOT NULL,
  vix       REAL,
  vix_band  TEXT,
  PRIMARY KEY (date, market)
);
CREATE INDEX IF NOT EXISTS idx_regime_lookup ON regime(market, label, vix_band);
