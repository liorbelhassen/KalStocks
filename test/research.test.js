import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectorBenchmark, parseSecAtom, parseFindings, researchQueries, gatherEvidence, checkerDomains, yahooNewsArticles, researchInstructions, cleanHebrewName, hebrewName, dailyArticles } from '../lib/research.js'

const NOW = Date.parse('2026-09-28T14:00:00Z')

test('sectorBenchmark: Yahoo sector/industry → sector index, per market', () => {
  assert.equal(sectorBenchmark({ market: 'IL', sector: 'Financial Services', industry: 'Banks - Regional' }).symbol, 'TA-BANKS.TA')
  assert.equal(sectorBenchmark({ market: 'US', sector: 'Technology', industry: 'Semiconductor Equipment & Materials' }).symbol, 'SMH')
  assert.equal(sectorBenchmark({ market: 'US', sector: 'Technology', industry: 'Consumer Electronics' }).symbol, 'XLK')
  assert.equal(sectorBenchmark({ market: 'IL', sector: null, industry: null }), null)
  assert.equal(sectorBenchmark({ market: 'US', sector: 'Financial Services', industry: 'Banks - Diversified' }).role, 'sector')
})

test('parseSecAtom: 8-K filings with date, link and the items in Hebrew', () => {
  const xml = `<feed><entry><content><filing-date>2026-09-28</filing-date><filing-href>https://www.sec.gov/a?x=1&amp;y=2</filing-href><filing-type>8-K</filing-type><items-desc>items 2.02 and 9.01</items-desc></content></entry>
  <entry><content><filing-date>2026-09-01</filing-date><filing-href>https://www.sec.gov/b</filing-href><filing-type>8-K</filing-type><items-desc>items 5.02</items-desc></content></entry></feed>`
  const got = parseSecAtom(xml)
  assert.equal(got.length, 2)
  assert.deepEqual([got[0].date, got[0].url, got[0].kind, got[0].host], ['2026-09-28', 'https://www.sec.gov/a?x=1&y=2', 'official', 'sec.gov'])
  assert.ok(got[0].title.includes('תוצאות כספיות') && !got[0].title.includes('9.01'))
  assert.ok(got[1].title.includes('שינויים בהנהלה'))
})

test('parseFindings: keeps only dated findings in the period whose URL the search really returned', () => {
  const text = `ממצאים:
- 2026-09-28 | החברה הודיעה על הסכם עם Kioxia | https://www.businesswire.com/news/x?utm_source=openai
- 2026-09-28 | אנליסט העלה מחיר יעד | https://made-up.example.com/y
- 2025-03-01 | דוח ישן | https://www.reuters.com/old
- בלי תאריך | https://www.reuters.com/z
ביטחון: בינונית
הסבר: ...`
  const got = parseFindings(text, { urls: ['https://www.businesswire.com/news/x', 'https://www.reuters.com/old'], now: NOW })
  assert.equal(got.length, 1)
  assert.deepEqual([got[0].host, got[0].kind, got[0].title, got[0].url], ['businesswire.com', 'research', 'החברה הודיעה על הסכם עם Kioxia', 'https://www.businesswire.com/news/x'])
  const week = { startDate: '2026-09-21', endDate: '2026-09-28' }
  assert.equal(parseFindings(text.replace('2026-09-28 | החברה', '2026-09-15 | החברה'), { urls: ['https://www.businesswire.com/n'], period: 'week', window: week, now: NOW }).length, 0)
  assert.deepEqual(parseFindings('הסבר: בלי ממצאים', { urls: [] }), [])
})

test('researchQueries: English name, sector and wrap-up searches (US); sector + TASE wrap-up (IL)', () => {
  const sector = sectorBenchmark({ market: 'US', sector: 'Technology', industry: 'Semiconductors' })
  const q = researchQueries({ market: 'US', profile: { name: 'Applied Materials, Inc.' }, sector })
  assert.deepEqual(q.map((x) => x.kind), ['company', 'sector', 'wrap'])
  assert.ok(q[0].query.includes('"Applied Materials"') && q[0].relevant('Applied Materials shares jump') && !q[0].relevant('Nvidia rallies'))
  assert.ok(q[1].relevant('Chip stocks slide'))
  const il = researchQueries({ market: 'IL', sector: sectorBenchmark({ market: 'IL', sector: 'Financial Services', industry: 'Banks - Regional' }) })
  assert.deepEqual(il.map((x) => x.kind), ['sector', 'wrap'])
  assert.ok(il[0].relevant('מניות הבנקים ירדו') && il[1].relevant('נעילה בתל אביב'))
  assert.deepEqual(researchQueries({ market: 'IL', isIndex: true }), [])
})

test('yahooNewsArticles: only items tagged with the ticker, inside the period', () => {
  const news = [
    { title: 'AMAT jumps on AI memory deal', publisher: 'Reuters', link: 'https://www.reuters.com/a', providerPublishTime: (NOW - 3600_000) / 1000, relatedTickers: ['AMAT'] },
    { title: 'Other company news', publisher: 'Reuters', link: 'https://www.reuters.com/b', providerPublishTime: (NOW - 3600_000) / 1000, relatedTickers: ['LRCX'] },
    { title: 'Old AMAT story', publisher: 'Reuters', link: 'https://www.reuters.com/c', providerPublishTime: (NOW - 20 * 86_400_000) / 1000, relatedTickers: ['AMAT'] },
  ]
  assert.deepEqual(yahooNewsArticles(news, { symbol: 'AMAT', now: NOW }).map((a) => [a.title, a.host, a.kind]), [['AMAT jumps on AI memory deal', 'reuters.com', 'company']])
})

const rssItem = (title, host, source, at) => `<item><title>${title} - ${source}</title><link>https://news.google.com/x</link><pubDate>${new Date(at).toUTCString()}</pubDate><source url="https://www.${host}">${source}</source></item>`

test('gatherEvidence: profile → sector, SEC filings first, company/sector/wrap news, all within the day', async () => {
  const urls = []
  const fetchImpl = async (u) => {
    const url = decodeURIComponent(String(u)); urls.push(url)
    if (url.includes('finance.yahoo.com/v1/finance/search')) return { ok: true, json: async () => ({ quotes: [{ symbol: 'AMAT', sector: 'Technology', industry: 'Semiconductor Equipment & Materials', longname: 'Applied Materials, Inc.' }], news: [] }) }
    if (url.includes('sec.gov')) return { ok: true, text: async () => '<entry><filing-date>2026-09-28</filing-date><filing-href>https://www.sec.gov/f</filing-href><filing-type>8-K</filing-type><items-desc>items 7.01</items-desc></entry>' }
    return { ok: true, text: async () => `<rss><channel>${url.includes('chip stocks') ? rssItem('Chip stocks rally on AI demand', 'reuters.com', 'Reuters', NOW - 3600_000) : ''}</channel></rss>` }
  }
  const ev = await gatherEvidence({ nameHe: 'אפלייד מטיריאלס', symbol: 'AMAT', market: 'US', now: NOW, fetchImpl })
  assert.equal(ev.sector.symbol, 'SMH')
  assert.deepEqual(ev.articles.map((a) => a.kind), ['official', 'sector'])
  assert.ok(urls.some((u) => u.includes('"Applied Materials"')) && urls.some((u) => u.includes('Wall Street')))

  const dead = async () => { throw new Error('offline') }
  assert.deepEqual((await gatherEvidence({ nameHe: 'x', symbol: 'AMAT', market: 'US', now: NOW, fetchImpl: dead })).articles, [])
})

test('researchInstructions / checkerDomains: official sources per market', () => {
  assert.ok(researchInstructions({ market: 'IL', when: 'היום' }).includes('maya.tase.co.il'))
  assert.ok(researchInstructions({ market: 'US', when: 'היום' }).includes('8-K'))
  const d = checkerDomains('IL', [{ host: 'ice.co.il' }])
  assert.ok(d.includes('globes.co.il') && d.includes('maya.tase.co.il') && d.includes('ice.co.il') && d.length <= 20)
  assert.equal(checkerDomains('US'), null)
})

test('sectorBenchmark: airlines get a news-only sector in Israel and JETS in the US', () => {
  const il = sectorBenchmark({ market: 'IL', sector: 'Industrials', industry: 'Airlines' })
  assert.equal(il.symbol, null)
  assert.ok(il.re.test('מניות התעופה זינקו'))
  assert.equal(sectorBenchmark({ market: 'US', sector: 'Industrials', industry: 'Airlines' }).symbol, 'JETS')
})

test('researchInstructions: asks for incidents at the company or its competitors', () => {
  for (const market of ['IL', 'US']) assert.ok(researchInstructions({ market, when: 'היום' }).includes('תקריות ביטחוניות'))
})

test('cleanHebrewName / hebrewName: one Hebrew press name, or null', async () => {
  assert.equal(cleanHebrewName('"אל על"'), 'אל על')
  assert.equal(cleanHebrewName('מניית אל על.\nהסבר נוסף'), 'אל על')
  assert.equal(cleanHebrewName('**בזק** ([globes.co.il](https://www.globes.co.il/x))'), 'בזק')
  assert.equal(cleanHebrewName('El Al Israel Airlines'), null)
  assert.equal(cleanHebrewName('השם העברי של החברה הוא אל על נתיבי אויר לישראל בעמ'), null)
  const ask = async (prompt) => ({ text: prompt.includes('ELAL.TA') && prompt.includes('El Al Israel Airlines') ? 'אל על' : '' })
  assert.equal(await hebrewName({ symbol: 'ELAL.TA', englishName: 'El Al Israel Airlines' }, {}, { ask }), 'אל על')
})

test('parseFindings: a URL followed by a backtick or quote keeps only the URL', () => {
  const text = `ממצאים:
- 2026-09-28 | אל על זינקה אחרי התקרית בטיסת פליי דובאי | https://passportnews.co.il/article/210323\`
ביטחון: בינונית`
  const got = parseFindings(text, { urls: ['https://passportnews.co.il/article/210323'], now: NOW })
  assert.equal(got[0].url, 'https://passportnews.co.il/article/210323')
})

test('dailyArticles: checked daily causes inside the window become period evidence, biggest move first', () => {
  const window = { startDate: '2026-09-23', endDate: '2026-09-30' }
  const briefs = [
    { date: '2026-09-30', explainedPct: 7.93, verdict: 'תוקן', assessment: 'אל על זינקה אחרי התקרית בטיסת פליי דובאי.', sources: [{ name: 'גלובס', url: 'https://www.globes.co.il/news/a' }, { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/quote/ELAL.TA' }] },
    { date: '2026-09-28', explainedPct: -1.2, verdict: 'אומת', assessment: 'ירידה עם השוק.', sources: [{ name: 'כלכליסט', url: 'https://www.calcalist.co.il/b' }] },
    { date: '2026-09-29', explainedPct: 2, verdict: 'נתונים בלבד', assessment: 'מספרים בלבד', sources: [] },
    { date: '2026-09-27', explainedPct: 3, verdict: 'תוקן', assessment: 'רק יאהו', sources: [{ name: 'Yahoo Finance', url: 'https://finance.yahoo.com/quote/ELAL.TA' }] },
    { date: '2026-09-23', explainedPct: 5, verdict: 'תוקן', assessment: 'לפני החלון', sources: [{ name: 'גלובס', url: 'https://www.globes.co.il/c' }] },
  ]
  const got = dailyArticles(briefs, window)
  assert.deepEqual(got.map((a) => [a.date, a.url, a.kind]), [['2026-09-30', 'https://www.globes.co.il/news/a', 'daily'], ['2026-09-28', 'https://www.calcalist.co.il/b', 'daily']])
  assert.ok(got[0].title.includes('+7.93%') && got[0].title.includes('פליי דובאי'))
  assert.deepEqual(dailyArticles(briefs, null), [])
})
