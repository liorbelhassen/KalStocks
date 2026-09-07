// Server-side price fetching from Yahoo Finance public chart API.
// Runs in Cloud Functions (no CORS constraint, unlike the browser).
//
// Verified coverage (2026-07): individual TASE equities work with the `.TA` suffix
// (POLI.TA, LUMI.TA, MZTF.TA, DSCT.TA, FIBI.TA...) and the index TA35.TA.
// TASE-listed ETFs (קרנות סל) are NOT on Yahoo — proxy them via TA35.TA.
// Equities are quoted in ILA (agorot); we normalize to ILS by dividing by 100.

const CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'

/**
 * Fetch a single symbol's chart data and return a normalized snapshot.
 * @param {string} symbol e.g. "POLI.TA" or "TA35.TA"
 * @param {object} opts   { interval='15m', range='1d', period1, period2 } — period1/period2 are
 *                        epoch seconds and take precedence over `range` (exact window).
 * @returns {Promise<{symbol,currency,priceIls,changePct,previousClose,series,at}>}
 *   `previousClose` is Yahoo's `chartPreviousClose`: the last close BEFORE the requested window,
 *   which is the correct baseline for a period change (not the first bar inside the window).
 */
export async function fetchSnapshot(symbol, { interval = '15m', range = '1d', period1, period2 } = {}) {
  const win = period1 && period2 ? `period1=${Math.floor(period1)}&period2=${Math.floor(period2)}` : `range=${range}`
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?interval=${interval}&${win}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (StocksInsights)' },
  })
  if (!res.ok) {
    throw new Error(`Yahoo fetch failed for ${symbol}: HTTP ${res.status}`)
  }
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) {
    throw new Error(`No chart data for ${symbol}`)
  }

  const meta = result.meta || {}
  const currency = meta.currency || 'ILA'
  // ILA = agorot → ILS (÷100). Indices are already in points (ILS); leave as-is.
  const isIndex = meta.instrumentType === 'INDEX'
  const divisor = isIndex ? 1 : currency === 'ILA' ? 100 : 1

  const closes = result.indicators?.quote?.[0]?.close || []
  const volumes = result.indicators?.quote?.[0]?.volume || []
  const timestamps = result.timestamp || []
  const series = timestamps
    .map((t, i) => ({ t: t * 1000, v: closes[i] == null ? null : closes[i] / divisor, vol: volumes[i] ?? null }))
    .filter((p) => p.v != null)

  const price = meta.regularMarketPrice != null ? meta.regularMarketPrice / divisor : series.at(-1)?.v
  const previousClose =
    (meta.chartPreviousClose ?? meta.previousClose) != null
      ? (meta.chartPreviousClose ?? meta.previousClose) / divisor
      : null
  const changePct =
    price != null && previousClose ? ((price - previousClose) / previousClose) * 100 : null

  return {
    symbol,
    nameHe: null, // filled from watchlist config
    currency,
    isIndex,
    priceIls: price,
    previousClose,
    changePct,
    series,
    at: meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now(),
    exchangeTz: meta.exchangeTimezoneName || null,
  }
}

/** Fetch many symbols, tolerating individual failures. */
export async function fetchSnapshots(symbols, opts) {
  const settled = await Promise.allSettled(symbols.map((s) => fetchSnapshot(s, opts)))
  return settled
    .map((r, i) => (r.status === 'fulfilled' ? r.value : { symbol: symbols[i], error: String(r.reason) }))
}
