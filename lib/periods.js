// Period ("day" / "week" / "month") window math + period change, shared by the Worker cron, the
// GitHub-Actions scripts and the tests. Pure functions (Intl only — no luxon) so the same code runs
// in Node and in the Cloudflare Worker.
//
// Every generated week/month explanation is tagged with a `key` that encodes
//   <priceSymbol>__<period>__<startDate>_<endDate>   (dates in the instrument's market timezone)
// so a stored explanation can only ever be served for the exact window it was written for.

import { logEvent } from './validate.js'

export const TZ_IL = 'Asia/Jerusalem'
export const TZ_US = 'America/New_York'

/** 'IL' for TASE-listed symbols (`.TA`) and manual (`X-…`) entries, 'US' for everything else. */
export function marketOf(symbol) {
  const s = String(symbol || '').toUpperCase()
  if (s.endsWith('.TA') || s.startsWith('X-') || s === '') return 'IL'
  return 'US'
}

export const marketTz = (market) => (market === 'US' ? TZ_US : TZ_IL)

/** YYYY-MM-DD of `ms` in `tz`. */
export function localDateISO(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}

// Offset (minutes) of `tz` from UTC at instant `ms`. DST-safe (derived from Intl, not a table).
function tzOffsetMinutes(ms, tz) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms))
  const g = (t) => +p.find((x) => x.type === t).value
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000)
}

/** Epoch ms of local midnight (start of day) for the calendar date `yyyy-mm-dd` in `tz`. */
export function startOfLocalDay(dateISO, tz) {
  const guess = Date.parse(`${dateISO}T00:00:00Z`)
  // Two passes handle the (rare) case where the offset differs across the DST boundary itself.
  let ms = guess - tzOffsetMinutes(guess, tz) * 60000
  ms = guess - tzOffsetMinutes(ms, tz) * 60000
  return ms
}

function shiftDateISO(dateISO, { days = 0, months = 0 }) {
  const [y, m, d] = dateISO.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, d + days))
  // Clamp month overflow (e.g. Mar 31 - 1 month → Feb 28), not "Mar 3".
  if (months && dt.getUTCDate() !== d) dt.setUTCDate(0)
  return dt.toISOString().slice(0, 10)
}

/**
 * The window a period explanation must describe, relative to `now`, in the instrument's market tz.
 *   day   → today's session (local calendar day)
 *   week  → the trailing 7 calendar days ending today  (≈ the last 5 sessions)
 *   month → the trailing calendar month ending today
 * `baseStart` is where the price fetch begins, so the baseline (`chartPreviousClose`) is the close on
 * `startDate` itself — the same "past week / past month" basis Google Finance uses.
 * Returns epoch bounds for Yahoo (`period1`/`period2`), the ISO dates for prompts/keys and the key.
 */
export function periodWindow({ period = 'day', now = Date.now(), symbol = '', market } = {}) {
  const mkt = market || marketOf(symbol)
  const tz = marketTz(mkt)
  const endDate = localDateISO(now, tz)
  let startDate
  if (period === 'week') startDate = shiftDateISO(endDate, { days: -7 })
  else if (period === 'month') startDate = shiftDateISO(endDate, { months: -1 })
  else startDate = endDate
  const start = startOfLocalDay(startDate, tz)
  const baseStart = period === 'day' ? start : startOfLocalDay(shiftDateISO(startDate, { days: 1 }), tz)
  const end = now
  return {
    period, market: mkt, tz, startDate, endDate, start, baseStart, end,
    key: periodKey(symbol, period, startDate, endDate),
  }
}

export const periodKey = (symbol, period, startDate, endDate) => `${symbol}__${period}__${startDate}_${endDate}`

/**
 * Percent change over a period snapshot. The baseline is Yahoo's `chartPreviousClose` (the close
 * right before the window) — NOT the first bar inside the window, which is a later, partial price
 * (with 30-min bars it is the close of the first half-hour, so the "week" change was off by the
 * first morning's move). Falls back to the first bar only when Yahoo omits the baseline.
 * Returns null when the change cannot be computed (no price / no series) so callers can refuse to
 * generate instead of explaining a fake "0.0%" move.
 */
export function periodChange(snap) {
  if (!snap) return null
  const vals = (snap.series || []).map((p) => p.v).filter((x) => x != null && Number.isFinite(x))
  const last = snap.priceIls != null ? snap.priceIls : vals.at(-1)
  const base = snap.previousClose != null && snap.previousClose > 0 ? snap.previousClose : vals.length > 1 ? vals[0] : null
  if (last == null || base == null || !(base > 0)) return null
  if (vals.length === 0 && snap.previousClose == null) return null
  return ((last - base) / base) * 100
}

/**
 * Is the price data fresh enough to explain `window`? A snapshot whose last trade is older than
 * `maxAgeDays` before the window end means the market has not traded in the window (holiday /
 * delisted / bad symbol) — do not publish an explanation for it.
 */
export function isPriceFresh(snap, window, maxAgeDays = 4) {
  const at = snap?.at || (snap?.series || []).at(-1)?.t
  if (!at) return false
  return window.end - at <= maxAgeDays * 86400000
}

/**
 * Fetch + compute one period for `symbol` via `fetchSnapshot` (injected for tests).
 * Resolves { window, snap, changePct } or throws a tagged Error (stage='price').
 */
export async function computePeriod(symbol, period, { now = Date.now(), fetchSnapshot, market } = {}) {
  const window = periodWindow({ period, now, symbol, market })
  const interval = period === 'month' ? '1d' : period === 'week' ? '30m' : '15m'
  const snap = await fetchSnapshot(symbol, { interval, period1: window.baseStart / 1000, period2: window.end / 1000 })
  const changePct = periodChange(snap)
  if (changePct == null) throw stageError('price', `no computable ${period} change for ${symbol}`)
  if (!isPriceFresh(snap, window)) throw stageError('price', `stale price data for ${symbol} (${period}): last trade ${new Date(snap.at).toISOString()}`)
  return { window, snap, changePct }
}

export function stageError(stage, message) {
  const e = new Error(message)
  e.stage = stage
  return e
}

/** A stored period entry is reusable only if its key matches the current window and it passed the fact-check. */
export function isCurrentPeriodEntry(entry, window) {
  return !!(entry && entry.key && entry.key === window.key && entry.explanation && entry.verdict)
}

// A stored week/month entry is shown only while its window is still current: its end date must be
// within the last few days (the job runs Mon–Fri, so a Friday window is fine on Sunday; a window from
// last month is not). Entries written before windows were keyed (no `endDate`) are treated as stale.
const MAX_PERIOD_AGE_DAYS = 3
export function isPeriodCurrent(p, now = Date.now()) {
  if (!p?.endDate) return false
  const end = Date.parse(`${p.endDate}T23:59:59Z`)
  return Number.isFinite(end) && now - end <= MAX_PERIOD_AGE_DAYS * 86400000
}

/**
 * Build the `periods/{priceSymbol}` document: week + month change/series + explanations.
 * - Reuses an `existing` entry when its key matches the current window (no duplicate LLM call).
 * - A failure in one period never blocks the other; every failure is logged with stage/symbol/period.
 * - `explanation` is written only when `explainMove` returned a validated text — never a blank string.
 */
export async function buildPeriodsDoc({ symbol, nameHe, now = Date.now(), keys, existing = null, fetchSnapshot, explainMove, sleep = async () => {} }) {
  const market = marketOf(symbol)
  const out = { symbol, market, updatedAt: now }
  const errors = []
  for (const period of ['week', 'month']) {
    let computed
    try {
      computed = await computePeriod(symbol, period, { now, fetchSnapshot, market })
    } catch (e) {
      errors.push(logEvent('warn', { stage: e.stage || 'price', symbol, period, error: e.message }))
      if (existing?.[period]) out[period] = existing[period] // keep the last good data rather than blanking
      continue
    }
    const { window, snap, changePct } = computed
    const base = {
      key: window.key, startDate: window.startDate, endDate: window.endDate, market,
      changePct: Math.round(changePct * 100) / 100, series: snap.series || [],
    }
    if (isCurrentPeriodEntry(existing?.[period], window)) {
      out[period] = { ...existing[period], ...base }
      continue
    }
    try {
      const r = await explainMove(
        { nameHe, symbol, market, changePct, direction: changePct >= 0 ? 'up' : 'down', date: window.endDate, period, window },
        keys,
      )
      out[period] = { ...base, explanation: r.explanation, confidence: r.confidence, sources: r.sources || [], model: r.provider || null, verdict: r.verdict || null, at: now }
    } catch (e) {
      errors.push(logEvent('warn', { stage: e.stage || 'llm', symbol, period, changePct: base.changePct, error: e.message }))
      out[period] = { ...base, explanation: null, confidence: null, sources: [] }
    }
    await sleep()
  }
  return { doc: out, errors }
}
