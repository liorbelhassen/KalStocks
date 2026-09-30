import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, triggerBand, briefOutdated } from '../lib/volatility.js'

test('classify: default threshold is 0.5% — a 0.6% day move is significant', () => {
  const c = classify({ changePct: 0.6 })
  assert.equal(c.significant, true)
  assert.equal(c.reason, 'daily-move')
  assert.equal(c.band, 1)
  assert.equal(c.direction, 'up')
})

test('classify: moves below 0.5% are not significant by default', () => {
  assert.equal(classify({ changePct: -0.4 }).significant, false)
})

test('classify: intraday swing triggers at 2× threshold (1% by default)', () => {
  const series = [{ v: 100 }, { v: 101.2 }, { v: 100.1 }]
  const c = classify({ changePct: 0.1, series })
  assert.equal(c.significant, true)
  assert.equal(c.reason, 'intraday-swing')
  assert.equal(classify({ changePct: 0.1, series: [{ v: 100 }, { v: 100.8 }] }).significant, false)
})

test('classify: explicit per-stock threshold still overrides the default', () => {
  assert.equal(classify({ changePct: 0.6 }, 3).significant, false)
  assert.equal(classify({ changePct: -3.2 }, 3).significant, true)
})

test('triggerBand: swing-only move (day band 0) is still level 1; insignificant is 0', () => {
  const swing = classify({ changePct: 0.1, series: [{ v: 100 }, { v: 101.2 }] })
  assert.equal(swing.band, 0)
  assert.equal(triggerBand(swing), 1)
  assert.equal(triggerBand(classify({ changePct: 1.6 })), 3)
  assert.equal(triggerBand(classify({ changePct: 0.2 })), 0)
})

test('briefOutdated: flipped or much larger move re-explains; legacy trigger brief without explainedPct is outdated', () => {
  assert.equal(briefOutdated({ explainedPct: -0.7, band: 1 }, -0.8), false)
  assert.equal(briefOutdated({ explainedPct: 0, band: 1 }, -0.69), true)
  assert.equal(briefOutdated({ explainedPct: -1.11, band: 2 }, -1.29), false)
  assert.equal(briefOutdated({ explainedPct: 0.6, band: 1 }, -0.6), true)
  assert.equal(briefOutdated({ explainedPct: 1, band: 2 }, 2.1), true)
  assert.equal(briefOutdated({ band: 1 }, 0.9), true)
  assert.equal(briefOutdated({ session: 'morning' }, 0.9), false)
  assert.equal(briefOutdated(null, 0.9), false)
})

test('keepCheckedBrief: a numbers-only retry never replaces a checked text for the same move', async () => {
  const { keepCheckedBrief } = await import('../lib/volatility.js')
  const checked = { assessment: 'דיסקונט ירדה יחד עם מדד הבנקים…', verdict: 'תוקן', explainedPct: -1.34 }
  const fb = { assessment: 'מניית בנק דיסקונט ירדה…', verdict: 'נתונים בלבד' }
  assert.equal(keepCheckedBrief(checked, fb, -1.3), true)
  assert.equal(keepCheckedBrief(checked, fb, 0.8), false)
  assert.equal(keepCheckedBrief(checked, { ...fb, verdict: 'תוקן' }, -1.3), false)
  assert.equal(keepCheckedBrief({ ...checked, verdict: 'נתונים בלבד' }, fb, -1.3), false)
  assert.equal(keepCheckedBrief(null, fb, -1.3), false)
})

test('briefOutdated: a text in the old price-path fallback format is always re-explained', () => {
  const old = { assessment: 'מיקרוסופט עלתה 1.67% בשבוע האחרון. הנקודה הגבוהה נרשמה ב-25.09 (+3.45%). לא נמצאה בחדשות סיבה ספציפית מאומתת לתנועה.', verdict: 'נתונים בלבד', explainedPct: 1.67 }
  assert.equal(briefOutdated(old, 1.67), true)
  assert.equal(briefOutdated({ ...old, assessment: 'מניית מיקרוסופט עלתה 1.67% יחד עם מניות הטכנולוגיה.' }, 1.67), false)
})
