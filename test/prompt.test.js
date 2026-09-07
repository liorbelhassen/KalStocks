import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExplainPrompt } from '../lib/explain.js'
import { buildAssessPrompt } from '../lib/morning.js'
import { validateInsight, MAX_INSIGHT_LEN } from '../lib/validate.js'

const base = { nameHe: 'בנק הפועלים', symbol: 'POLI.TA', changePct: -3.2, direction: 'down', date: '2026-09-07' }

test('buildExplainPrompt: refuses to build a prompt when the move data is missing', () => {
  for (const bad of [
    { ...base, changePct: null },
    { ...base, changePct: NaN },
    { ...base, changePct: undefined },
    { ...base, date: undefined },
    { ...base, nameHe: '' },
    { ...base, symbol: '' },
    { ...base, reason: 'intraday-swing', changePct: null, swingPct: null },
  ]) {
    assert.throws(() => buildExplainPrompt(bad), (e) => e.stage === 'input', JSON.stringify(bad))
  }
  // A swing event carries swingPct instead of changePct — that is enough.
  assert.ok(buildExplainPrompt({ ...base, reason: 'intraday-swing', changePct: null, swingPct: 4.5 }).includes('4.5%'))
})

test('buildExplainPrompt (day): injects the exact stock, market, direction, size, date and its own news', () => {
  const p = buildExplainPrompt({ ...base, newsContext: '\n- (על הנייר) הפועלים מדווח' })
  assert.ok(p.includes('"בנק הפועלים"'))
  assert.ok(p.includes('POLI.TA'))
  assert.ok(p.includes('בבורסת תל אביב'))
  assert.ok(p.includes('ירד בכ-3.2%'))
  assert.ok(p.includes('2026-09-07'))
  assert.ok(p.includes('הפועלים מדווח'))
  assert.ok(p.includes('עקבי עם הכיוון והגודל'), 'must constrain the model to the given move')
})

test('buildExplainPrompt: US stock is described on Wall Street, and Israeli news is explicitly excluded', () => {
  const p = buildExplainPrompt({ nameHe: 'אפל', symbol: 'AAPL', changePct: 2, date: '2026-09-07' })
  assert.ok(p.includes('וול סטריט'))
  assert.ok(!p.includes('בבורסת תל אביב'))
  assert.ok(p.includes('נייר אמריקאי'))
  assert.ok(p.includes('עלה בכ-2.0%'))
})

test('buildExplainPrompt (week/month): states the exact date range and drops hour-level headlines', () => {
  const window = { startDate: '2026-08-31', endDate: '2026-09-07' }
  const p = buildExplainPrompt({ ...base, changePct: 5, period: 'week', window, newsContext: '\n- כותרת של היום' })
  assert.ok(p.includes('מ-2026-08-31 עד 2026-09-07'))
  assert.ok(p.includes('בשבוע האחרון'))
  assert.ok(!p.includes('כותרת של היום'), 'today headlines must not be used to explain a whole week')
  const m = buildExplainPrompt({ ...base, period: 'month', window: { startDate: '2026-08-07', endDate: '2026-09-07' } })
  assert.ok(m.includes('בחודש האחרון') && m.includes('מ-2026-08-07 עד 2026-09-07'))
})

test('buildAssessPrompt: missing name/date → input error; US vs IL session wording; direction fact injected', () => {
  assert.throws(() => buildAssessPrompt({ nameHe: '', date: '2026-09-07' }), (e) => e.stage === 'input')
  assert.throws(() => buildAssessPrompt({ nameHe: 'אפל', symbol: 'AAPL' }), (e) => e.stage === 'input')

  const us = buildAssessPrompt({ nameHe: 'אפל', symbol: 'AAPL', date: '2026-09-07', changePct: -1.5 })
  assert.ok(us.includes('טרם נפתח היום'), 'US stock at Israeli morning has not traded yet')
  assert.ok(us.includes('ירדה ב-1.50%'))
  assert.ok(!us.includes('בבורסת תל אביב'))

  const il = buildAssessPrompt({ nameHe: 'בנק הפועלים', symbol: 'POLI.TA', date: '2026-09-07', session: 'midday', changePct: 1.2 })
  assert.ok(il.includes('אמצע יום המסחר'))
  assert.ok(il.includes('עלתה ב-1.20%'))
  const idx = buildAssessPrompt({ nameHe: 'ת"א 35', symbol: 'TA35.TA', isIndex: true, date: '2026-09-07', session: 'midday', changePct: -0.8 })
  assert.ok(idx.includes('המדד ירד ב-0.80%'), 'index uses masculine verb')
  // Tiny moves are not asserted as a "fact" (avoids forcing a story onto noise).
  assert.ok(!buildAssessPrompt({ nameHe: 'x', symbol: 'X.TA', date: '2026-09-07', changePct: 0.02 }).includes('עובדה מחייבת'))
})

const good = 'המניה ירדה בעקבות פרסום דוחות רבעוניים שהציגו שחיקה ברווח הנקי ועלייה בהפרשות להפסדי אשראי, לצד ירידות רוחביות במדד הבנקים בתל אביב על רקע ציפיות לריבית גבוהה לאורך זמן.'

test('validateInsight: accepts a real Hebrew explanation', () => {
  assert.deepEqual(validateInsight(good), { ok: true })
  assert.deepEqual(validateInsight(good, { mustMention: 'בנק הפועלים' }), { ok: true, warning: 'name-not-mentioned' })
  assert.deepEqual(validateInsight(`הפועלים: ${good}`, { mustMention: 'בנק הפועלים' }), { ok: true })
})

test('validateInsight: rejects empty / short / long / English / generic / template outputs', () => {
  assert.equal(validateInsight('').reason, 'empty')
  assert.equal(validateInsight(null).reason, 'empty')
  assert.equal(validateInsight('המניה ירדה.').reason, 'too-short')
  assert.equal(validateInsight(good.repeat(3)).reason, 'too-long')
  assert.equal(validateInsight('Apple shares fell after the company reported weaker than expected iPhone sales in China, and analysts cut their price targets.').reason, 'not-hebrew')
  assert.equal(validateInsight(`${good} מומלץ לעקוב אחרי ההתפתחויות.`).reason, 'generic')
  assert.equal(validateInsight('לא נמצא מידע ספציפי על המניה היום, אולם ייתכן שהתנועה קשורה למגמה הכללית בשוק ולציפיות המשקיעים לגבי הריבית.').reason, 'generic')
  assert.equal(validateInsight('הסבר: <ההסבר בעברית, 2-3 משפטים מהותיים> ואז עוד טקסט ארוך כדי לעבור את מבחן האורך המינימלי של הבדיקה הזו כאן.').reason, 'generic')
  assert.equal(validateInsight(`ביטחון: בינונית\n${good}`).reason, 'template')
  assert.ok(MAX_INSIGHT_LEN >= 400)
})
