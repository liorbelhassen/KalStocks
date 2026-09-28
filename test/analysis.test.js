import { test } from 'node:test'
import assert from 'node:assert/strict'
import { measuredAnalysis, seriesPath } from '../lib/analysis.js'
import { explainMove } from '../lib/explain.js'
import { diagnoseMove } from '../lib/market.js'

const TZ = 'America/New_York'
const day = (d, v) => ({ t: Date.parse(`2026-${d}T20:00:00Z`), v })
// ^DJI-like month: base 53,780 (close before the window) → trough mid-month → 51,828.62.
const series = [day('08-28', 53600), day('09-02', 53900), day('09-09', 52400), day('09-16', 51300), day('09-17', 52300), day('09-28', 51828.62)]
const facts = [{ symbol: '^GSPC', label: 'S&P 500', changePct: -1.1 }, { symbol: '^IXIC', label: 'נאסד"ק', changePct: 0.4 }]

test('seriesPath: peak/trough and biggest day in % of the baseline implied by the change', () => {
  const p = seriesPath({ series, changePct: -3.63, period: 'month', tz: TZ })
  assert.equal(new Date(p.high.t).toISOString().slice(0, 10), '2026-09-02')
  assert.equal(new Date(p.low.t).toISOString().slice(0, 10), '2026-09-16')
  assert.ok(Math.abs(p.low.pct - (51300 / (51828.62 / 0.9637) - 1) * 100) < 1e-9)
  assert.equal(new Date(p.bigDay.t).toISOString().slice(0, 10), '2026-09-09')
  assert.equal(seriesPath({ series: series.slice(0, 1), changePct: 1 }), null)
})

test('measuredAnalysis: a significant move always gets benchmarks, path and an honest no-cause line', () => {
  const diagnosis = diagnoseMove({ symbol: '^DJI', isIndex: true, changePct: -3.63, facts })
  const t = measuredAnalysis({ subject: 'דאו ג\'ונס', isIndex: true, changePct: -3.63, period: 'month', facts, diagnosis, series, tz: TZ })
  assert.match(t, /^דאו ג'ונס ירד 3\.63% בחודש האחרון\./)
  assert.ok(t.includes('S&P 500 −1.10%') && t.includes('נאסד"ק +0.40%'))
  assert.ok(t.includes('02.09') && t.includes('16.09') && t.includes('09.09'))
  assert.ok(t.includes('לא נמצאה בחדשות סיבה ספציפית מאומתת'))
  const withNews = measuredAnalysis({ subject: 'בנק דיסקונט', changePct: -3.15, period: 'week', series, tz: TZ, articles: [{ title: 'נפילת עסקת כאל', source: 'גלובס' }] })
  assert.match(withNews, /^בנק דיסקונט ירדה 3\.15% בשבוע האחרון\./)
  assert.ok(withNews.includes('"נפילת עסקת כאל" (גלובס)') && withNews.includes('לא כסיבה מאומתת'))
  assert.equal(measuredAnalysis({ subject: 'x', changePct: null }), null)
})

test('explainMove: when every AI path fails, a significant move still gets the measured analysis', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'down', json: async () => ({}) })
  const r = await explainMove({
    nameHe: 'דאו ג\'ונס', symbol: '^DJI', market: 'US', isIndex: true, changePct: -3.63, direction: 'down', date: '2026-09-28',
    period: 'month', window: { startDate: '2026-08-28', endDate: '2026-09-28' }, series, marketFacts: facts, articles: [],
  }, { openaiKey: 'o', geminiKey: 'g' })
  assert.equal(r.verdict, 'נתונים בלבד')
  assert.match(r.explanation, /^דאו ג'ונס ירד 3\.63% בחודש האחרון\./)
  assert.deepEqual(r.sources, ['Yahoo Finance'])
})

test('measuredAnalysis: Hebrew prepositions attach correctly to Latin and definite labels', () => {
  const t = (ref) => measuredAnalysis({ subject: 'מדד ת"א 35', isIndex: true, changePct: -0.8, facts: [ref], diagnosis: { kind: 'market-wide', ref } })
  assert.ok(t({ label: 'S&P 500', changePct: -0.7 }).includes('בדומה ל-S&P 500'))
  assert.ok(t({ label: 'החוזים העתידיים בוול סטריט', changePct: -1 }).includes('בדומה לחוזים העתידיים'))
})
