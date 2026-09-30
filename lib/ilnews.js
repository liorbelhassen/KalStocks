// Dated news articles for one instrument, pulled from Google News RSS. For Israeli instruments the
// search is restricted to the Israeli financial press (Globes, Calcalist, Bizportal), plus a general
// Google News (Hebrew) search. Calcalist and Bizportal have no usable public RSS, and Calcalist
// blocks direct fetches, so Google News is how their articles are retrieved. These articles are the
// evidence the drafter and the fact-checker must tie causal claims to; Yahoo only supplies prices.
import { logEvent } from './validate.js'
import { hostOf } from './openai.js'

export const IL_NEWS_DOMAINS = ['globes.co.il', 'calcalist.co.il', 'bizportal.co.il']
const SOURCE_HE = { 'globes.co.il': 'גלובס', 'en.globes.co.il': 'גלובס', 'calcalist.co.il': 'כלכליסט', 'bizportal.co.il': 'ביזפורטל' }
const DAY = 86_400_000

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim()

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10)

// Index tickers collide with company names ("DJI" drones), so indices are searched by name.
const US_INDEX_NEWS = {
  '^DJI': { query: 'Dow Jones', re: /\bDow\b/i },
  '^GSPC': { query: 'S&P 500', re: /S&P ?500/i },
  '^IXIC': { query: 'Nasdaq', re: /\bNasdaq\b/i },
}
// Publishers whose headlines may be quoted as context in a measured analysis of a US instrument.
export const US_CONTEXT_HOSTS = /(^|\.)(reuters\.com|bloomberg\.com|cnbc\.com|wsj\.com|marketwatch\.com|barrons\.com|ft\.com|apnews\.com|finance\.yahoo\.com|investors\.com|nasdaq\.com|seekingalpha\.com|nytimes\.com|investing\.com|axios\.com|forbes\.com|fortune\.com|businessinsider\.com|morningstar\.com|thestreet\.com)$/

/** Headlines fit to quote as period context: Israeli financial press as fetched, US only from major outlets. */
const QUOTE_PAGE_RE = /Quote Comparison|Stock Prices? \||Stock Quote|Price Chart|Live levels/i

export const contextArticles = (articles = [], market = 'IL') =>
  articles.filter((a) => !QUOTE_PAGE_RE.test(a.title || '') &&
    (market !== 'US' || US_CONTEXT_HOSTS.test(a.host || '')))

const TA_RE = /ת["״]?א[- ]?35|TA35|TA-35/i
const MARKET_TERMS = /ת["״]א|תל אביב|בורס|מעו["״]?ף|המניות/

/**
 * Google News query phrase and the title test an article must pass to count as being about the
 * instrument (tag pages, quote pages and option-series listings share the words but aren't news).
 */
export function searchPhrase({ nameHe, symbol, isIndex, market }) {
  if (market === 'US') {
    const idx = US_INDEX_NEWS[symbol]
    if (idx) return { query: `"${idx.query}"`, relevant: (t) => idx.re.test(t) }
    const root = String(symbol || '').replace(/^\^/, '')
    return { query: `"${root}" stock`, relevant: (t) => t.toUpperCase().includes(root.toUpperCase()) || (nameHe && t.includes(nameHe)) }
  }
  if (TA_RE.test(`${nameHe} ${symbol}`)) return { query: 'ת"א', relevant: (t) => MARKET_TERMS.test(t) }
  const core = String(nameHe || '').replace(/^(מדד|בנק|מניית|חברת)\s+/, '').trim()
  if (!core) return null
  const phrase = isIndex && !/^מדד/.test(core) ? `מדד ${core}` : core
  // Whole word, allowing Hebrew one-letter prefixes (ו/ה/ב/ל/כ/ש) — "טבע" must not match "מטבע".
  const word = new RegExp(`(^|[^\\p{L}])[והבלכש]{0,2}${core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u')
  return { query: `"${phrase}"`, relevant: (t) => word.test(t) }
}

// The unrestricted Google News search matches sports/local news with the same words.
const FINANCE_GROUP = '(מניה OR מניית OR מניות OR בורסה OR מדד OR בנק OR רווח OR דוח)'

const NOISE_RE = /Tokenized|price today|(pre-market|after-hours) at|נגזרים|אופציות|אופצית|\b[PC] \d|\b(OCT|NOV|DEC|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP)\b|דף אג["״]ח|^מניית .{1,25}$|^מדד .{1,25}$|: חדשות$/
const isNews = (t) => t.split(/\s+/).length >= 5 && !NOISE_RE.test(t)

/** Google News date operator: `when:` for the current day, exact after/before for a period window. */
export function timeFilter({ period = 'day', window = null }) {
  if (period !== 'day' && window?.startDate && window?.endDate) {
    return `after:${ymd(Date.parse(window.startDate) - DAY)} before:${ymd(Date.parse(window.endDate) + DAY)}`
  }
  return 'when:1d'
}

export function googleNewsUrl(query, market = 'IL') {
  const loc = market === 'US' ? 'hl=en-US&gl=US&ceid=US:en' : 'hl=he&gl=IL&ceid=IL:he'
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${loc}`
}

/** Parse a Google News RSS document into { title, source, host, date, at, url }. */
export function parseGoogleNews(xml) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const it = m[1]
    const srcUrl = it.match(/<source url="([^"]+)"/)?.[1] || ''
    const source = decode(it.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '')
    let title = decode(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '')
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -source.length - 3).trim()
    const at = Date.parse(it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '')
    const host = hostOf(srcUrl) || ''
    return { title, source: SOURCE_HE[host] || source || host, host, at, date: Number.isFinite(at) ? ymd(at) : null, url: decode(it.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '') }
  }).filter((a) => a.title && Number.isFinite(a.at))
}

export const inWindow = (a, { period, window, now }) => {
  if (period !== 'day' && window?.startDate && window?.endDate) {
    return a.at >= Date.parse(window.startDate) - DAY && a.at <= Date.parse(window.endDate) + 2 * DAY
  }
  return a.at >= now - 1.5 * DAY && a.at <= now + DAY
}

// Evidence order in the prompt: official disclosures, then news about the company, its sector, the
// market wrap-up. Within a kind, the Israeli financial press first, newest first.
const KIND_RANK = { official: 0, company: 1, sector: 2, wrap: 3 }
const PER_KIND = { sector: 3, wrap: 3 }

/**
 * Articles about the instrument in the period, Israeli financial press first. `extraQueries`
 * ([{ query, relevant, kind }]) adds sector / market-wrap / English-name searches. Never throws: a
 * failed feed is logged and contributes nothing.
 */
export async function fetchArticles({ nameHe, symbol, isIndex = false, market = 'IL', period = 'day', window = null, now = Date.now(), limit = 10, extraQueries = [], fetchImpl = fetch } = {}) {
  const phrase = searchPhrase({ nameHe, symbol, isIndex, market })
  if (!phrase && !extraQueries.length) return []
  const when = timeFilter({ period, window })
  const own = phrase
    ? [
        ...(market === 'US' ? [] : IL_NEWS_DOMAINS.map((d) => `${phrase.query} site:${d} ${when}`)),
        market === 'US' ? `${phrase.query} ${when}` : `${phrase.query} ${FINANCE_GROUP} ${when}`,
      ].map((query) => ({ query, relevant: phrase.relevant, kind: 'company' }))
    : []
  const queries = [...own, ...extraQueries.map((q) => ({ ...q, query: `${q.query} ${when}` }))]
  const lists = await Promise.all(queries.map(async ({ query, relevant, kind }) => {
    try {
      const r = await fetchImpl(googleNewsUrl(query, market), { headers: { 'User-Agent': 'Mozilla/5.0 (StocksInsights)' } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return parseGoogleNews(await r.text()).filter((a) => relevant(a.title)).map((a) => ({ ...a, kind }))
    } catch (e) {
      logEvent('warn', { stage: 'news', source: 'google-news', symbol, error: String(e.message || e) })
      return []
    }
  }))
  const seen = new Set()
  const perKind = {}
  const isIl = (a) => IL_NEWS_DOMAINS.some((d) => a.host === d || a.host.endsWith(`.${d}`))
  return lists.flat()
    .filter((a) => inWindow(a, { period, window, now }) && isNews(a.title))
    .sort((a, b) => (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || (isIl(b) - isIl(a)) || (b.at - a.at))
    .filter((a) => { const k = a.title.replace(/[^\p{L}\p{N}]/gu, ''); if (seen.has(k)) return false; seen.add(k); return true })
    .filter((a) => { perKind[a.kind] = (perKind[a.kind] || 0) + 1; return perKind[a.kind] <= (PER_KIND[a.kind] || limit) })
    .slice(0, limit)
}

const KIND_HE = { official: 'דיווח רשמי', sector: 'הענף', wrap: 'סיכום השוק', research: 'ממצא', daily: 'הסבר יומי מאומת' }

/** Numbered prompt block. The model cites articles as [#n]. */
export function describeArticles(articles = [], { market = 'IL' } = {}) {
  const press = market === 'US' ? 'SEC, Yahoo Finance ו-Google News' : 'גלובס, כלכליסט, ביזפורטל ו-Google News'
  if (!articles.length) return `\nכתבות מהתקופה (${press}): לא נמצאו כתבות על הנייר בתקופה הזו.\n`
  const lines = articles.map((a, i) => `[#${i + 1}] ${a.date} | ${a.source}${KIND_HE[a.kind] ? ` | ${KIND_HE[a.kind]}` : ''} | ${a.title}`)
  return `\nכתבות מהתקופה (${press}) — אלה הראיות העיקריות לסיבת התנועה:
${lines.join('\n')}
טענה סיבתית חייבת להישען על כתבה מהרשימה (או על כתבה מאתרים אלה שמצאת בחיפוש) שמקשרת במפורש בין הגורם לתנועה. כותרת על אירוע אינה הוכחה שהאירוע הזיז את השוק.\n`
}
