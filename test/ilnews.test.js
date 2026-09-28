import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGoogleNews, fetchArticles, describeArticles, searchPhrase, timeFilter, contextArticles } from '../lib/ilnews.js'
import { challengeInsight } from '../lib/factcheck.js'
import { diagnoseMove } from '../lib/market.js'

const NOW = Date.parse('2026-09-28T12:00:00Z')
const item = (title, host, sourceName, when, link = `https://news.google.com/rss/articles/${encodeURIComponent(title).slice(0, 12)}`) =>
  `<item><title>${title} - ${sourceName}</title><link>${link}</link><pubDate>${new Date(when).toUTCString()}</pubDate><source url="https://www.${host}">${sourceName}</source></item>`
const rss = (...items) => `<?xml version="1.0"?><rss><channel>${items.join('')}</channel></rss>`

test('parseGoogleNews: strips the source suffix and maps Israeli sites to Hebrew names', () => {
  const [a] = parseGoogleNews(rss(item('יום נוסף של נסיגה בת&quot;א בצל ירידות בעולם', 'calcalist.co.il', 'Calcalist', NOW - 3_600_000)))
  assert.equal(a.title, 'יום נוסף של נסיגה בת"א בצל ירידות בעולם')
  assert.equal(a.source, 'כלכליסט')
  assert.equal(a.host, 'calcalist.co.il')
  assert.equal(a.date, '2026-09-28')
})

test('fetchArticles: queries Globes/Calcalist/Bizportal + Google News, keeps only dated, relevant news', async () => {
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(decodeURIComponent(String(url)))
    return { ok: true, text: async () => rss(
      item('נפילת עסקת כאל: חורש יכתוב צ\'ק של 187 מ\' ש\' לדיסקונט והבינלאומי', 'globes.co.il', 'גלובס', NOW - 7_200_000),
      item('דיסקונט קיבל פנייה לקראת תביעה נגזרת בעניין כאל', 'funder.co.il', 'פאנדר', NOW - 3_600_000),
      item('דסק P 3500 OCT - עסקאות נגזרים של דיסקונט', 'bizportal.co.il', 'ביזפורטל', NOW - 3_600_000),
      item('בנק דיסקונט', 'bizportal.co.il', 'ביזפורטל', NOW - 3_600_000),
      item('דיסקונט הודיע על דיבידנד חריג לבעלי המניות', 'globes.co.il', 'גלובס', NOW - 20 * 86_400_000),
    ) }
  }
  const got = await fetchArticles({ nameHe: 'בנק דיסקונט', symbol: 'DSCT.TA', now: NOW, fetchImpl })
  assert.equal(urls.length, 4)
  for (const d of ['globes.co.il', 'calcalist.co.il', 'bizportal.co.il']) assert.ok(urls.some((u) => u.includes(`"דיסקונט" site:${d} when:1d`)))
  assert.ok(urls.some((u) => !u.includes('site:') && u.includes('בורסה')), 'general Google News search is finance-scoped')
  assert.deepEqual(got.map((a) => a.host), ['globes.co.il', 'funder.co.il'], 'Israeli press first; option listings, tag pages and old items dropped')
  assert.ok(describeArticles(got).includes('[#1] 2026-09-28 | גלובס | נפילת עסקת כאל'))
})

test('searchPhrase / timeFilter: whole-word match, TA-35 market terms, exact period window', () => {
  const teva = searchPhrase({ nameHe: 'טבע', symbol: 'TEVA.TA' })
  assert.equal(teva.relevant('כך מניות הפכו למטבע חזק בעסקאות רכישה'), false)
  assert.equal(teva.relevant('מניית טבע זינקה אחרי הדוחות'), true)
  assert.equal(searchPhrase({ nameHe: 'מדד ת"א 35', symbol: 'TA35.TA', isIndex: true }).relevant('ירידות בת"א: השקל עלה ב-1%'), true)
  assert.equal(timeFilter({ period: 'week', window: { startDate: '2026-09-21', endDate: '2026-09-28' } }), 'after:2026-09-20 before:2026-09-29')
})

test('challengeInsight: an article cited as #n verifies the claim and shows its site as the source; search is limited to the Israeli press', async () => {
  const facts = [{ symbol: 'NQ=F', label: 'החוזים העתידיים על הנאסד"ק', changePct: -0.95 }]
  const articles = [{ title: 'יום נוסף של נסיגה בת"א בצל ירידות בעולם', source: 'כלכליסט', host: 'calcalist.co.il', date: '2026-09-28', url: 'https://news.google.com/rss/articles/abc' }]
  const final = 'מדד ת"א 35 ירד 0.49% היום, יום נוסף של נסיגה בבורסה בתל אביב בצל הירידות בעולם, כשהחוזים העתידיים על הנאסד"ק ירדו 0.95% והכבידו על מניות הטכנולוגיה והבנקים.'
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body))
    const body = { output: [{ type: 'message', content: [{ type: 'output_text', text: `פסק: תוקן\nטענות מאומתות:\n- נסיגה בת"א בצל ירידות בעולם | #1\nנפסלו:\n- אין\nביטחון: בינונית\nהסבר סופי: ${final}` }] }] }
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) }
  }
  const r = await challengeInsight({
    draft: 'טיוטה', subject: 'מדד ת"א 35', isIndex: true, changePct: -0.49, facts, diagnosis: diagnoseMove({ symbol: 'TA35.TA', isIndex: true, changePct: -0.49, facts }),
    moveText: '−0.49%', when: '2026-09-28', periodHe: 'היום', articles, articlesBlock: describeArticles(articles), allowedDomains: ['globes.co.il', 'calcalist.co.il', 'bizportal.co.il'],
  }, { openaiKey: 'o' })
  assert.equal(r.text, final)
  assert.deepEqual(r.sources, ['calcalist.co.il', 'Yahoo Finance'])
  assert.deepEqual(calls[0].tools[0].filters.allowed_domains, ['globes.co.il', 'calcalist.co.il', 'bizportal.co.il'])
  assert.ok(calls[0].input.includes('[#1] 2026-09-28 | כלכליסט'))
})

test('searchPhrase: US indices are searched by name, so "DJI" drones never match the Dow', () => {
  const p = searchPhrase({ symbol: '^DJI', market: 'US', isIndex: true })
  assert.equal(p.query, '"Dow Jones"')
  assert.equal(p.relevant('DJI Neo 3 Leak: New Body'), false)
  assert.equal(p.relevant('Dow falls 500 points as yields jump'), true)
  const a = [{ title: 'x', host: 'reuters.com' }, { title: 'y', host: 'tech-ish.com' }]
  assert.deepEqual(contextArticles(a, 'US').map((x) => x.host), ['reuters.com'])
  assert.equal(contextArticles(a, 'IL').length, 2)
  assert.equal(contextArticles([{ title: 'AMAT,NVDA | Stock Prices | Quote Comparison - Yahoo Finance', host: 'finance.yahoo.com' }], 'US').length, 0)
})

