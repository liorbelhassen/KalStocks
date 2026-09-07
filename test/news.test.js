import { test } from 'node:test'
import assert from 'node:assert/strict'
import { instrumentTerms, matchHeadlines, buildNewsContext } from '../lib/telegram.js'

const HEADLINES = [
  'בנק הפועלים מדווח על רווח נקי של 2.1 מיליארד שקל ברבעון',
  'לאומי משיק שירות דיגיטלי חדש ללקוחות עסקיים',
  'Apple unveils new iPhone lineup at fall event',
  'אנבידיה חצתה שווי של 4 טריליון דולר',
  'מתיחות בגבול הצפון: צה"ל תקף מטרות בלבנון',
  'בנק ישראל הותיר את הריבית ללא שינוי',
  'טבע: ה-FDA אישר תרופה חדשה',
]

test('instrumentTerms: company-specific names/aliases/ticker root, without sector words', () => {
  const t = instrumentTerms({ nameHe: 'בנק הפועלים', symbol: 'POLI.TA' })
  assert.ok(t.includes('הפועלים'))
  assert.ok(t.includes('hapoalim'))
  assert.ok(t.includes('poli'))
  assert.ok(!t.includes('בנק'), 'sector word "בנק" must not identify Hapoalim')
  assert.ok(!t.includes('bank'))

  const n = instrumentTerms({ nameHe: 'אנבידיה', symbol: 'NVDA' })
  assert.ok(n.includes('nvidia'))
  assert.ok(!n.includes('שבבים'))
})

test('matchHeadlines: each headline goes to the right company only (no TASE/US cross-contamination)', () => {
  const poli = matchHeadlines(HEADLINES, { nameHe: 'בנק הפועלים', symbol: 'POLI.TA' })
  assert.deepEqual(poli, [HEADLINES[0]])
  const lumi = matchHeadlines(HEADLINES, { nameHe: 'בנק לאומי', symbol: 'LUMI.TA' })
  assert.deepEqual(lumi, [HEADLINES[1]])
  const aapl = matchHeadlines(HEADLINES, { nameHe: 'אפל', symbol: 'AAPL' })
  assert.deepEqual(aapl, [HEADLINES[2]])
  const nvda = matchHeadlines(HEADLINES, { nameHe: 'אנבידיה', symbol: 'NVDA' })
  assert.deepEqual(nvda, [HEADLINES[3]])
  // "בנק ישראל" (central bank) is not Hapoalim/Leumi even though both have the "בנק" alias.
  assert.ok(!poli.includes(HEADLINES[5]) && !lumi.includes(HEADLINES[5]))
})

test('matchHeadlines: unknown instrument with only a short/generic name matches nothing', () => {
  assert.deepEqual(matchHeadlines(HEADLINES, { nameHe: 'בנק', symbol: 'ZZ' }), [])
})

test('buildNewsContext: IL gets own + general Israeli headlines; US gets company headlines only', () => {
  const il = buildNewsContext(HEADLINES, { market: 'IL', nameHe: 'בנק הפועלים', symbol: 'POLI.TA' })
  assert.ok(il.includes('(על הנייר) בנק הפועלים'))
  assert.ok(il.includes('מתיחות בגבול הצפון'))
  assert.ok(il.indexOf('(על הנייר)') < il.indexOf('מתיחות בגבול הצפון'), 'own headlines come first')

  const us = buildNewsContext(HEADLINES, { market: 'US', nameHe: 'אפל', symbol: 'AAPL' })
  assert.ok(us.includes('(על הנייר) Apple unveils'))
  assert.ok(!us.includes('צה"ל'), 'Israeli security news must not reach a US prompt')
  assert.ok(!us.includes('בנק ישראל'))
  assert.ok(!us.includes('אנבידיה'))
})

test('buildNewsContext: no relevant headlines → empty string (model falls back to its own search)', () => {
  assert.equal(buildNewsContext(HEADLINES, { market: 'US', nameHe: 'מיקרוסופט', symbol: 'MSFT' }), '')
  assert.equal(buildNewsContext([], { market: 'IL', nameHe: 'בנק הפועלים', symbol: 'POLI.TA' }), '')
  assert.equal(buildNewsContext(null, { market: 'IL' }), '')
})
