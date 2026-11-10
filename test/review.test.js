import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPeriodsDoc, isPeriodCurrent, marketOf, MAX_PERIOD_AGE_DAYS } from '../lib/periods.js'
import { periodFactsText } from '../lib/factsText.js'
import { periodInsight, tileView } from '../src/components/tileBits.js'
import { buildExplainPrompt } from '../lib/explain.js'
import { buildAssessPrompt } from '../lib/morning.js'
import { buildChallengePrompt } from '../lib/factcheck.js'
import { isWeak } from '../lib/llm.js'
import { MAX_INSIGHT_LEN, MIN_DEEP_LEN } from '../lib/validate.js'

const NOW = Date.UTC(2026, 8, 7, 8, 0, 0) // Mon 11:00 Israel
const goodHe = 'מניית בנק הפועלים ירדה בעקבות דוח רבעוני חלש מהצפוי, ירידה ברווח הנקי ושחיקה בהכנסות הריבית, על רקע ציפיות להורדת ריבית בנק ישראל. '.repeat(2)

test('marketOf: numeric TASE security ids are Israeli', () => {
  assert.equal(marketOf('1146570'), 'IL')
  assert.equal(marketOf('AAPL'), 'US')
})

test('isPeriodCurrent: a Thursday window survives a weekend + 2-day holiday; a 2-week-old one does not', () => {
  assert.ok(MAX_PERIOD_AGE_DAYS >= 5)
  const tuesdayAfterHoliday = Date.UTC(2026, 8, 15, 6, 0, 0)
  assert.equal(isPeriodCurrent({ endDate: '2026-09-10' }, tuesdayAfterHoliday), true)
  assert.equal(isPeriodCurrent({ endDate: '2026-08-31' }, tuesdayAfterHoliday), false)
})

test('buildPeriodsDoc: a price failure records an explicit error per period and never blocks the other period', async () => {
  const fetchSnapshot = async (symbol, opts) => {
    if (symbol === 'POLI.TA' && opts.interval === '30m') throw new Error('yahoo 404')
    return { priceIls: symbol === 'TA35.TA' ? 101 : 110, previousClose: 100, at: NOW, series: [{ t: NOW - 1000, v: 100 }, { t: NOW, v: 110 }] }
  }
  const explainMove = async () => ({ explanation: goodHe, confidence: 'גבוהה', sources: [], verdict: 'אושר' })
  const { doc, errors } = await buildPeriodsDoc({ symbol: 'POLI.TA', nameHe: 'בנק הפועלים', now: NOW, keys: {}, existing: null, fetchSnapshot, explainMove })
  assert.equal(doc.week.error, 'price')
  assert.equal(doc.week.changePct, undefined)
  assert.equal(doc.month.changePct, 10)
  assert.deepEqual(doc.month.benchmark, { symbol: 'TA35.TA', label: 'מדד ת"א 35', changePct: 1 })
  assert.equal(errors.length, 1)

  // existing good data is kept (with the error flag) instead of being blanked
  const again = await buildPeriodsDoc({ symbol: 'POLI.TA', nameHe: 'בנק הפועלים', now: NOW, keys: {}, existing: { week: { changePct: 3, endDate: '2026-09-07' } }, fetchSnapshot, explainMove })
  assert.equal(again.doc.week.changePct, 3)
  assert.equal(again.doc.week.error, 'price')
})

test('periodInsight: every state has a clear message; data-only text is labelled as data, not an insight', () => {
  assert.match(periodInsight(null, 'week', { now: NOW, manualOnly: true }).text, /מחיר ידני/)
  assert.equal(periodInsight(null, 'week', { now: NOW }).kind, 'pending')
  assert.equal(periodInsight({ error: 'price' }, 'month', { now: NOW }).kind, 'error')
  const p = { changePct: 4.2, startDate: '2026-08-31', endDate: '2026-09-07', series: [{ v: 100 }, { v: 106 }, { v: 104.2 }], benchmark: { label: 'מדד ת"א 35', changePct: 1.1 } }
  const d = periodInsight(p, 'week', { now: NOW })
  assert.equal(d.kind, 'data')
  assert.match(d.label, /ללא ניתוח AI/)
  assert.match(d.label, /31\.08–07\.09/)
  assert.match(d.text, /4\.20%/)
  assert.match(d.text, /1\.10%/)
  assert.match(d.text, /חזק מהשוק/)
  const m = periodInsight({ ...p, market: 'IL', benchmark: { symbol: 'TA35.TA', label: 'מדד ת"א 35', changePct: 1.1 } }, 'week', { now: NOW, symbol: 'POLI.TA' })
  assert.equal(m.kind, 'data')
  assert.match(m.text, /4\.2/)
  assert.match(m.text, /1\.1/)
  const ai = periodInsight({ ...p, explanation: goodHe, verdict: 'אושר', confidence: 'גבוהה' }, 'week', { now: NOW })
  assert.equal(ai.kind, 'insight')
  assert.equal(ai.text, goodHe)
})

test('tileView: hides an out-of-date window but explains why; live fallback numbers are shown', () => {
  const stale = tileView({ periods: { week: { changePct: 2, endDate: '2026-07-01' } } }, 'week', NOW)
  assert.equal(stale.pct, null)
  assert.ok(stale.insight.text)
  const live = tileView({ periods: { week: { changePct: 2, startDate: '2026-08-31', endDate: '2026-09-07', series: [], live: true } } }, 'week', NOW)
  assert.equal(live.pct, 2)
  assert.equal(live.ts, null)
  assert.match(tileView({ manualOnly: true, periods: null }, 'month', NOW).insight.text, /מחיר ידני/)
})

test('factsText: no text without a measured change', () => {
  assert.equal(periodFactsText({}, 'week'), null)
})

test('prompts demand deep, specific analyses and allow room for them through fact-check', () => {
  assert.ok(MAX_INSIGHT_LEN >= 800)
  const e = buildExplainPrompt({ nameHe: 'בנק הפועלים', symbol: 'POLI.TA', changePct: -3.2, direction: 'down', date: '2026-09-07' })
  const a = buildAssessPrompt({ nameHe: 'בנק הפועלים', symbol: 'POLI.TA', date: '2026-09-07' })
  for (const p of [e, a]) {
    assert.match(p, /4-6 משפטים/)
    assert.match(p, /השלכות/)
    assert.doesNotMatch(p, /2-3 משפטים|250-425/)
  }
  const c = buildChallengePrompt({ draft: goodHe, subject: 'בנק הפועלים', moveText: 'ירדה 3.2%', when: 'היום', factsBlock: '' })
  assert.doesNotMatch(c, /150-425/)
  assert.match(c, new RegExp(`${MIN_DEEP_LEN}-${MAX_INSIGHT_LEN}`))
})

test('isWeak: a one-line recap is weak; a multi-factor analysis is not', () => {
  assert.equal(isWeak('המניה ירדה 3% היום בעקבות ירידות בשוק הרחב ובענף הבנקים, על רקע חששות מהריבית.'), true)
  assert.equal(isWeak(goodHe), false)
})
