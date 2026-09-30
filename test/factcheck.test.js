import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkClaims, parseVerdict, challengeInsight } from '../lib/factcheck.js'
import { diagnoseMove, describeFacts, benchmarksFor, fetchMarketFacts } from '../lib/market.js'

const facts = [
  { symbol: '^GSPC', label: 'S&P 500', changePct: -0.55 },
  { symbol: '^IXIC', label: 'נאסד"ק', changePct: -0.83 },
  { symbol: 'ES=F', label: 'החוזים העתידיים על S&P 500', changePct: -0.48 },
  { symbol: 'NQ=F', label: 'החוזים העתידיים על הנאסד"ק', changePct: -0.95 },
]
const ta35 = { symbol: 'TA35.TA', isIndex: true, changePct: -0.49 }
const bogus = 'הירידה הנוכחית במדד ת"א 35 נובעת ככל הנראה מהמתיחות הגאופוליטית באזור, במיוחד בעקבות הפעילות הצה"לית בדרום לבנון והמצב הכלכלי באיראן. אם המתיחות תימשך או תחריף, צפויה המשך ירידה בשוק.'
const grounded = 'מדד ת"א 35 ירד 0.49% היום, בהתאמה לירידות בוול סטריט: החוזים על הנאסד"ק ירדו כ-0.95% על רקע מימושים במניות השבבים, מה שהכביד על מניות הטכנולוגיה והבנקים בתל אביב.'

test('diagnoseMove: TA-35 tracking US futures is market-wide; a stock far from TA-35 is specific', () => {
  const d = diagnoseMove({ ...ta35, facts })
  assert.equal(d.kind, 'market-wide')
  assert.equal(d.ref.changePct, -0.71)
  assert.equal(diagnoseMove({ symbol: 'DSCT.TA', changePct: 3, facts: [{ symbol: 'TA35.TA', label: 'מדד ת"א 35', changePct: 0.1 }] }).kind, 'specific')
  assert.equal(diagnoseMove({ symbol: 'DSCT.TA', changePct: 0.1, facts }).kind, 'flat')
  assert.ok(!benchmarksFor('TA35.TA').includes('TA35.TA'))
  assert.ok(describeFacts({ facts, changePct: -0.49, diagnosis: d }).includes('תנועה רוחבית'))
})

test('checkClaims: rejects the Iran/Lebanon story for a market-wide TA-35 move', () => {
  const diagnosis = diagnoseMove({ ...ta35, facts })
  const r = checkClaims(bogus, { changePct: -0.49, facts, diagnosis, verified: [] })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'unsupported-geopolitics')
  // Even with a verified geopolitical article, a market-wide move must name the market driver.
  const geoOnly = 'המדד ירד בעקבות הדיווחים על הסלמה בלבנון, שהכבידו על המשקיעים המקומיים לאורך כל יום המסחר.'
  assert.equal(checkClaims(geoOnly, { changePct: -0.49, facts, diagnosis, verified: [{ claim: 'הסלמה בלבנון הכבידה על הבורסה', url: 'https://x' }] }).reason, 'ignores-market-driver')
})

test('checkClaims: accepts a text grounded in the measured numbers; rejects invented numbers', () => {
  const diagnosis = diagnoseMove({ ...ta35, facts })
  assert.deepEqual(checkClaims(grounded, { changePct: -0.49, facts, diagnosis }), { ok: true })
  assert.match(checkClaims(grounded.replace('0.95%', '2.4%'), { changePct: -0.49, facts, diagnosis }).reason, /unsupported-number/)
})

const verdictText = (verdict, claims, final) => `פסק: ${verdict}
טענות מאומתות:
${claims}
נפסלו:
- לבנון — אין כתבה שמקשרת
ביטחון: בינונית
הסבר סופי: ${final}`

test('parseVerdict: reads verdict, verified claims with URLs, rejections and final text', () => {
  const p = parseVerdict(verdictText('תוקן', '- החוזים על הנאסד"ק ירדו 0.95% | https://www.globes.co.il/news/a?utm_source=openai', grounded))
  assert.equal(p.verdict, 'תוקן')
  assert.deepEqual(p.verified, [{ claim: 'החוזים על הנאסד"ק ירדו 0.95%', url: 'https://www.globes.co.il/news/a' }])
  assert.equal(p.rejected.length, 1)
  assert.equal(p.final, grounded)
  assert.deepEqual(parseVerdict(verdictText('נדחה', '- אין', 'x')).verified, [])
})

function mockChecker(body) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) }
  }
  return calls
}
const openaiOut = (text, searched = []) => ({ output: [
  { type: 'web_search_call', action: { sources: searched.map((url) => ({ url })) } },
  { type: 'message', content: [{ type: 'output_text', text }] },
] })
const args = (draft) => ({ draft, subject: 'מדד ת"א 35', isIndex: true, changePct: -0.49, facts, diagnosis: diagnoseMove({ ...ta35, facts }), moveText: '−0.49%', when: '2026-09-28', periodHe: 'היום' })

test('challengeInsight: a corrected, source-verified text is published with the verified sources', async () => {
  const calls = mockChecker(openaiOut(verdictText('תוקן', '- החוזים על הנאסד"ק ירדו 0.95% על רקע מימושים בשבבים | https://www.globes.co.il/a', grounded), ['https://www.globes.co.il/a']))
  const r = await challengeInsight(args(bogus), { openaiKey: 'o' })
  assert.equal(r.text, grounded)
  assert.deepEqual(r.sources, [{ name: 'גלובס', url: 'https://www.globes.co.il/a' }, { name: 'Yahoo Finance', url: null }])
  assert.equal(calls[0].body.model, 'gpt-5.4-mini', 'checker runs on an independent model')
  assert.ok(calls[0].body.input.includes(bogus))
})

test('challengeInsight: rejected draft → facts-only text for a market-wide move, never the draft', async () => {
  mockChecker(openaiOut(verdictText('נדחה', '- אין', bogus)))
  const r = await challengeInsight(args(bogus), { openaiKey: 'o' })
  assert.equal(r.verdict, 'נתונים בלבד')
  assert.ok(!/לבנון|איראן/.test(r.text))
  assert.ok(r.text.includes('0.49%') && r.text.includes('וול סטריט'))
  assert.deepEqual(r.sources, [{ name: 'Yahoo Finance', url: null }])
})

test('challengeInsight: a URL the checker never retrieved does not count as verification', async () => {
  mockChecker(openaiOut(verdictText('אושר', '- הסלמה בלבנון הפילה את המדד | https://invented.example/x', bogus), ['https://www.globes.co.il/a']))
  const r = await challengeInsight(args(bogus), { openaiKey: 'o' })
  assert.equal(r.verdict, 'נתונים בלבד')
})

test('challengeInsight: checker failure or no fallback → throws, nothing is published', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => 'bad', json: async () => ({}) })
  await assert.rejects(challengeInsight(args(bogus), { openaiKey: 'o' }), (e) => e.stage === 'factcheck')
  mockChecker(openaiOut(verdictText('נדחה', '- אין', bogus)))
  const specific = { ...args(bogus), diagnosis: { kind: 'specific', ref: { label: 'מדד ת"א 35', changePct: 0.1 } } }
  await assert.rejects(challengeInsight(specific, { openaiKey: 'o' }), (e) => e.stage === 'factcheck')
})

test('fetchMarketFacts: day facts drop stale/failed benchmarks; periods use the exact window', async () => {
  const now = Date.parse('2026-09-28T12:00:00Z')
  const seen = []
  const fetchSnapshot = async (s, opts) => {
    seen.push([s, opts])
    if (s === '^IXIC') throw new Error('down')
    return { changePct: -0.5, at: s === 'ILS=X' ? now - 10 * 86400000 : now }
  }
  const f = await fetchMarketFacts({ symbol: 'TA35.TA', now, fetchSnapshot })
  assert.deepEqual(f.map((x) => x.symbol), ['^GSPC', 'ES=F', 'NQ=F'])
  const w = { start: 1000, end: 2000 }
  await fetchMarketFacts({ symbol: 'DSCT.TA', period: 'week', window: w, now, fetchSnapshot })
  assert.deepEqual(seen.at(-1)[1], { interval: '1d', period1: 1, period2: 2 })
})

test('checkClaims: rejects checker meta-commentary leaking into the published text', () => {
  const diagnosis = diagnoseMove({ ...ta35, facts })
  const leaked = `${grounded} לא אומת בסיס לדוחות מאכזבים כגורם המכריע.`
  assert.equal(checkClaims(leaked, { changePct: -0.49, facts, diagnosis }).reason, 'meta-commentary')
})

test('checkClaims: a sector-wide move must be explained through the sector', () => {
  const sf = [{ symbol: 'TA35.TA', label: 'מדד ת"א 35', changePct: -0.1 }, { symbol: 'TA-BANKS.TA', label: 'מדד הבנקים', group: 'מניות הבנקים', role: 'sector', changePct: -1 }]
  const diagnosis = diagnoseMove({ symbol: 'DSCT.TA', changePct: -1.2, facts: sf })
  assert.equal(diagnosis.kind, 'sector-wide')
  const own = checkClaims('מניית בנק דיסקונט ירדה 1.20% היום אחרי שהמשקיעים חששו מהתוצאות של החברה ברבעון הקרוב.', { changePct: -1.2, facts: sf, diagnosis, verified: [] })
  assert.deepEqual([own.ok, own.reason], [false, 'ignores-sector-driver'])
  const sec = checkClaims('מניית בנק דיסקונט ירדה 1.20% היום יחד עם כל מניות הבנקים, שנחלשו אחרי שבנק ישראל השאיר את הריבית ללא שינוי.', { changePct: -1.2, facts: sf, diagnosis, verified: [] })
  assert.notEqual(sec.reason, 'ignores-sector-driver')
})
