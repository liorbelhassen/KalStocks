import { test } from 'node:test'
import assert from 'node:assert/strict'
import { measuredAnalysis, subjectHe } from '../lib/analysis.js'
import { explainMove } from '../lib/explain.js'
import { diagnoseMove } from '../lib/market.js'
import { validateInsight } from '../lib/validate.js'

const BOILERPLATE = /לא נמצא|שיא|שפל|הנקודה הגבוהה|היום החד/
const us = [{ symbol: '^GSPC', label: 'S&P 500', changePct: -1.1 }, { symbol: '^IXIC', label: 'נאסד"ק', changePct: 0.4 }]

test('subjectHe: company → "מניית X", index → "מדד X", generic subjects unchanged', () => {
  assert.equal(subjectHe('בנק דיסקונט'), 'מניית בנק דיסקונט')
  assert.equal(subjectHe('דאו ג\'ונס', true), 'מדד דאו ג\'ונס')
  assert.equal(subjectHe('מדד ת"א 35', true), 'מדד ת"א 35')
  assert.equal(subjectHe('הנייר'), 'הנייר')
})

test('measuredAnalysis: sector-wide move says the whole sector moved, with its headline, no price-path narration', () => {
  const facts = [{ symbol: 'TA35.TA', label: 'מדד ת"א 35', changePct: -0.2 }, { symbol: 'TA-BANKS.TA', label: 'מדד הבנקים', group: 'מניות הבנקים', role: 'sector', changePct: -0.9 }]
  const diagnosis = diagnoseMove({ symbol: 'DSCT.TA', changePct: -1.29, facts })
  assert.equal(diagnosis.kind, 'sector-wide')
  const t = measuredAnalysis({ subject: 'בנק דיסקונט', market: 'IL', changePct: -1.29, facts, diagnosis, articles: [
    { title: 'המניות הגדולות בבורסה נפלו', source: 'גלובס', kind: 'wrap' },
    { title: 'מניות הבנקים נחלשו אחרי החלטת הריבית', source: 'TheMarker', kind: 'sector' },
  ] })
  assert.match(t, /^מניית בנק דיסקונט ירדה 1\.29% היום יחד עם מניות הבנקים: במדד הבנקים נרשמה ירידה של 0\.90%\./)
  assert.ok(t.includes('המשקיעים מכרו') && t.includes('"מניות הבנקים נחלשו אחרי החלטת הריבית" (TheMarker)'), t)
  assert.ok(!BOILERPLATE.test(t), t)
  assert.ok(validateInsight(t).ok, t)
})

test('measuredAnalysis: TASE move following Wall Street, US stock with the market, stock-specific move', () => {
  const ref = { label: 'החוזים העתידיים בוול סטריט', changePct: -1 }
  const ta = measuredAnalysis({ subject: 'מדד ת"א 35', isIndex: true, market: 'IL', changePct: -0.8, facts: [], diagnosis: { kind: 'market-wide', ref, market: ref } })
  assert.match(ta, /^מדד ת"א 35 ירד 0\.80% היום בעקבות וול סטריט: בחוזים העתידיים בוול סטריט נרשמה ירידה של 1\.00%\./)
  assert.ok(ta.includes('הגיבו למה שקרה בשווקים בארה"ב'))

  const spx = { symbol: '^GSPC', label: 'S&P 500', changePct: 0.7 }
  const aapl = measuredAnalysis({ subject: 'אפל', market: 'US', changePct: 0.64, facts: [spx], diagnosis: diagnoseMove({ symbol: 'AAPL', changePct: 0.64, facts: [spx] }) })
  assert.match(aapl, /^מניית אפל עלתה 0\.64% היום יחד עם כל וול סטריט: ב-S&P 500 נרשמה עלייה של 0\.70%\./)

  const dji = measuredAnalysis({ subject: 'דאו ג\'ונס', isIndex: true, market: 'US', changePct: -3.63, period: 'month', facts: us, diagnosis: diagnoseMove({ symbol: '^DJI', isIndex: true, changePct: -3.63, facts: us }) })
  assert.match(dji, /^מדד דאו ג'ונס ירד 3\.63% בחודש האחרון, הרבה יותר מהשוק \(S&P 500: −1\.10%\)\./)
  assert.ok(dji.includes('המשקיעים מכרו דווקא את מדד דאו ג\'ונס'))
  for (const t of [ta, aapl, dji]) assert.ok(!BOILERPLATE.test(t) && validateInsight(t).ok, t)
  assert.equal(measuredAnalysis({ subject: 'x', changePct: null }), null)
})

test('explainMove: when every AI path fails, a significant move still gets the plain-language analysis', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'down', json: async () => ({}) })
  const r = await explainMove({
    nameHe: 'דאו ג\'ונס', symbol: '^DJI', market: 'US', isIndex: true, changePct: -3.63, direction: 'down', date: '2026-09-28',
    period: 'month', window: { startDate: '2026-08-28', endDate: '2026-09-28' }, marketFacts: us, articles: [],
  }, { openaiKey: 'o', geminiKey: 'g' })
  assert.equal(r.verdict, 'נתונים בלבד')
  assert.match(r.explanation, /^מדד דאו ג'ונס ירד 3\.63% בחודש האחרון/)
  assert.deepEqual(r.sources, ['Yahoo Finance'])
})
