import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  marketOf, periodWindow, periodChange, periodKey, computePeriod, isCurrentPeriodEntry, isPriceFresh, buildPeriodsDoc,
  localDateISO, startOfLocalDay, isPeriodCurrent,
} from '../lib/periods.js'

// Mon 2026-09-07 08:00 UTC = 11:00 Israel (IDT, +3) = 04:00 New York (EDT, -4)
const NOW = Date.UTC(2026, 8, 7, 8, 0, 0)

test('marketOf: TASE / manual → IL, everything else → US', () => {
  assert.equal(marketOf('POLI.TA'), 'IL')
  assert.equal(marketOf('X-manual'), 'IL')
  assert.equal(marketOf('AAPL'), 'US')
  assert.equal(marketOf('^GSPC'), 'US')
})

test('day window is the local calendar day of the instrument market (not UTC, not Israel for US)', () => {
  // 23:30 New York on Sep 6 is already Sep 7 in UTC and Israel.
  const lateNy = Date.UTC(2026, 8, 7, 3, 30)
  assert.equal(periodWindow({ period: 'day', now: lateNy, symbol: 'AAPL' }).endDate, '2026-09-06')
  assert.equal(periodWindow({ period: 'day', now: lateNy, symbol: 'POLI.TA' }).endDate, '2026-09-07')
})

test('week/month windows: trailing 7 days / 1 calendar month, start at local midnight', () => {
  const wk = periodWindow({ period: 'week', now: NOW, symbol: 'POLI.TA' })
  assert.equal(wk.startDate, '2026-08-31')
  assert.equal(wk.endDate, '2026-09-07')
  assert.equal(wk.start, startOfLocalDay('2026-08-31', 'Asia/Jerusalem'))
  assert.equal(localDateISO(wk.start, 'Asia/Jerusalem'), '2026-08-31')
  assert.equal(new Date(wk.start).toISOString(), '2026-08-30T21:00:00.000Z') // IDT = UTC+3
  assert.equal(wk.end, NOW)

  const mo = periodWindow({ period: 'month', now: NOW, symbol: 'AAPL' })
  assert.equal(mo.startDate, '2026-08-07')
  assert.equal(new Date(mo.start).toISOString(), '2026-08-07T04:00:00.000Z') // EDT = UTC-4
})

test('month window clamps end-of-month (Mar 31 → Feb 28, not Mar 3)', () => {
  const mar31 = Date.UTC(2026, 2, 31, 12)
  assert.equal(periodWindow({ period: 'month', now: mar31, symbol: 'POLI.TA' }).startDate, '2026-02-28')
})

test('window key encodes symbol + period + exact date range → a new day gets a new key', () => {
  const a = periodWindow({ period: 'week', now: NOW, symbol: 'POLI.TA' })
  const b = periodWindow({ period: 'week', now: NOW + 86400000, symbol: 'POLI.TA' })
  assert.equal(a.key, periodKey('POLI.TA', 'week', '2026-08-31', '2026-09-07'))
  assert.notEqual(a.key, b.key)
  assert.notEqual(a.key, periodWindow({ period: 'month', now: NOW, symbol: 'POLI.TA' }).key)
  assert.notEqual(a.key, periodWindow({ period: 'week', now: NOW, symbol: 'LUMI.TA' }).key)
})

test('periodChange uses the close BEFORE the window, not the first bar inside it', () => {
  // Baseline 100 (Friday close). First 30-min bar of the week already 103; last 110.
  const snap = { priceIls: 110, previousClose: 100, series: [{ t: 1, v: 103 }, { t: 2, v: 110 }] }
  assert.equal(periodChange(snap), 10)
  // Old code: (110-103)/103 = 6.8% — a different number.
  assert.notEqual(Math.round(periodChange(snap)), 7)
})

test('periodChange returns null (never 0%) when the data cannot support a number', () => {
  assert.equal(periodChange(null), null)
  assert.equal(periodChange({ priceIls: null, previousClose: null, series: [] }), null)
  assert.equal(periodChange({ priceIls: 10, previousClose: 0, series: [] }), null)
  // No baseline but ≥2 bars → falls back to first bar.
  assert.equal(periodChange({ priceIls: null, previousClose: null, series: [{ v: 50 }, { v: 55 }] }), 10)
})

test('isPriceFresh rejects a snapshot whose last trade predates the window by > 4 days', () => {
  const w = periodWindow({ period: 'week', now: NOW, symbol: 'POLI.TA' })
  assert.equal(isPriceFresh({ at: NOW - 86400000 }, w), true)
  assert.equal(isPriceFresh({ at: NOW - 10 * 86400000 }, w), false)
  assert.equal(isPriceFresh({}, w), false)
})

test('computePeriod passes the exact epoch window to Yahoo and throws a staged error on bad data', async () => {
  const calls = []
  const fetchSnapshot = async (symbol, opts) => {
    calls.push({ symbol, ...opts })
    return { symbol, priceIls: 105, previousClose: 100, at: NOW, series: [{ t: NOW - 1000, v: 104 }] }
  }
  const r = await computePeriod('POLI.TA', 'week', { now: NOW, fetchSnapshot })
  assert.equal(r.changePct, 5)
  assert.equal(calls[0].interval, '30m')
  assert.equal(calls[0].period1, startOfLocalDay('2026-09-01', 'Asia/Jerusalem') / 1000) // baseline = close on 08-31, like Google's 5D/1M
  assert.equal(calls[0].period2, NOW / 1000)
  assert.equal(calls[0].range, undefined)

  await assert.rejects(
    computePeriod('POLI.TA', 'week', { now: NOW, fetchSnapshot: async () => ({ priceIls: null, series: [] }) }),
    (e) => e.stage === 'price',
  )
  await assert.rejects(
    computePeriod('POLI.TA', 'month', { now: NOW, fetchSnapshot: async () => ({ priceIls: 1, previousClose: 1, at: NOW - 30 * 86400000, series: [{ v: 1 }] }) }),
    (e) => e.stage === 'price' && /stale/.test(e.message),
  )
})

test('isCurrentPeriodEntry: only an entry with the exact current key counts', () => {
  const w = periodWindow({ period: 'week', now: NOW, symbol: 'POLI.TA' })
  assert.equal(isCurrentPeriodEntry({ key: w.key, explanation: 'x', verdict: 'אושר' }, w), true)
  assert.equal(isCurrentPeriodEntry({ key: w.key, explanation: 'written before the fact-check' }, w), false)
  assert.equal(isCurrentPeriodEntry({ key: w.key, explanation: null }, w), false)
  assert.equal(isCurrentPeriodEntry({ explanation: 'legacy, no key' }, w), false)
  assert.equal(isCurrentPeriodEntry({ key: 'POLI.TA__week__2026-08-24_2026-08-31', explanation: 'old' }, w), false)
})

const goodHe = 'המניה עלתה בעקבות פרסום דוחות כספיים חזקים לרבעון השני, שכללו צמיחה בהכנסות ושיפור ברווחיות, לצד עליות רוחביות במדד הבנקים בבורסת תל אביב.'

test('buildPeriodsDoc: reuses explanation for the same window, regenerates for a new one, never blanks on failure', async () => {
  const fetchSnapshot = async () => ({ priceIls: 110, previousClose: 100, at: NOW, series: [{ t: NOW, v: 110 }] })
  let llmCalls = 0
  const explainMove = async (input) => { llmCalls++; return { explanation: `${goodHe} (${input.period})`, confidence: 'גבוהה', sources: [], provider: 'test', verdict: 'אושר' } }

  const first = await buildPeriodsDoc({ symbol: 'POLI.TA', nameHe: 'בנק הפועלים', now: NOW, keys: {}, existing: null, fetchSnapshot, explainMove })
  assert.equal(llmCalls, 2)
  assert.equal(first.doc.week.key, periodKey('POLI.TA', 'week', '2026-08-31', '2026-09-07'))
  assert.equal(first.doc.week.changePct, 10)
  assert.equal(first.doc.market, 'IL')

  // Same day, second run (midday): numbers refreshed, no new LLM calls.
  const again = await buildPeriodsDoc({ symbol: 'POLI.TA', nameHe: 'בנק הפועלים', now: NOW + 3600000, keys: {}, existing: first.doc, fetchSnapshot, explainMove })
  assert.equal(llmCalls, 2)
  assert.equal(again.doc.week.explanation, first.doc.week.explanation)

  // Next day: new window → regenerate both.
  const next = await buildPeriodsDoc({ symbol: 'POLI.TA', nameHe: 'בנק הפועלים', now: NOW + 86400000, keys: {}, existing: first.doc, fetchSnapshot, explainMove })
  assert.equal(llmCalls, 4)
  assert.notEqual(next.doc.week.key, first.doc.week.key)

  // LLM failure on a ≥0.5% move: a measured-data analysis is written, the numbers are still written, other period unaffected.
  const failing = async (input) => { if (input.period === 'week') throw Object.assign(new Error('boom'), { stage: 'llm' }); return explainMove(input) }
  const failed = await buildPeriodsDoc({ symbol: 'POLI.TA', nameHe: 'בנק הפועלים', now: NOW + 2 * 86400000, keys: {}, existing: null, fetchSnapshot, explainMove: failing })
  assert.ok(failed.doc.week.explanation.startsWith('מניית בנק הפועלים עלתה 10.00% בשבוע האחרון'))
  assert.equal(failed.doc.week.verdict, 'נתונים בלבד')
  assert.equal(failed.doc.week.changePct, 10)
  assert.ok(failed.doc.month.explanation)
  assert.equal(failed.errors.length, 1)
  assert.deepEqual([failed.errors[0].stage, failed.errors[0].symbol, failed.errors[0].period], ['llm', 'POLI.TA', 'week'])

  // Below 0.5% there is nothing to explain: failure leaves the explanation empty.
  const flat = async () => ({ priceIls: 100.2, previousClose: 100, at: NOW, series: [{ t: NOW, v: 100.2 }] })
  const quiet = await buildPeriodsDoc({ symbol: 'POLI.TA', nameHe: 'בנק הפועלים', now: NOW, keys: {}, existing: null, fetchSnapshot: flat, explainMove: failing })
  assert.equal(quiet.doc.week.explanation, null)
})

test('isPeriodCurrent: window ending recently is current; old or unkeyed entries are stale', () => {
  const now = Date.parse('2026-09-28T08:00:00Z')
  assert.equal(isPeriodCurrent({ endDate: '2026-09-28' }, now), true)
  assert.equal(isPeriodCurrent({ endDate: '2026-09-25' }, now), true)
  assert.equal(isPeriodCurrent({ endDate: '2026-07-09' }, now), false)
  assert.equal(isPeriodCurrent({ changePct: 3.1, explanation: 'x' }, now), false)
  assert.equal(isPeriodCurrent(null, now), false)
})

test('isCurrentPeriodEntry: a text written for a different move or leaking checker commentary is not reused', () => {
  const w = { key: 'K' }
  const e = { key: 'K', explanation: 'המדד ירד 1.10% בשבוע האחרון.', verdict: 'נתונים בלבד', explainedPct: -1.1 }
  assert.equal(isCurrentPeriodEntry(e, w, -1.2), true)
  assert.equal(isCurrentPeriodEntry(e, w, 1.17), false)
  assert.equal(isCurrentPeriodEntry({ ...e, explainedPct: undefined }, w, -1.1), false)
  assert.equal(isCurrentPeriodEntry({ ...e, explanation: 'לא אומת בסיס לדוחות מאכזבים' }, w), false)
})


test('isCurrentPeriodEntry: an old price-path fallback text is not reused', async () => {
  const { isCurrentPeriodEntry } = await import('../lib/periods.js')
  const window = { key: 'MSFT__week__2026-09-23_2026-09-30' }
  const entry = { key: window.key, verdict: 'נתונים בלבד', explainedPct: 1.67, explanation: 'מיקרוסופט עלתה 1.67% בשבוע האחרון. באותה תקופה: S&P 500 −0.46%; לעומת S&P 500 (−0.46%) — כלומר תנועה ייחודית לנייר. הנקודה הגבוהה נרשמה ב-25.09.' }
  assert.equal(isCurrentPeriodEntry(entry, window, 1.67), false)
  assert.equal(isCurrentPeriodEntry({ ...entry, explanation: 'מניית מיקרוסופט עלתה 1.67% בשבוע האחרון, הרבה יותר מהשוק.' }, window, 1.67), true)
})
