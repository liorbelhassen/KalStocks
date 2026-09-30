// Deeper evidence for a move, beyond the instrument's own headlines: its sector benchmark (so the
// numbers say whether the whole sector moved), official filings (SEC 8-K for US companies), Yahoo
// Finance company news (analyst actions, press releases), sector and market wrap-up articles, and
// a search by the English company name. The drafter then researches on top of this (official
// disclosures, IR pages, analysts) and must list dated, linked findings, which the fact-checker
// receives as evidence. Every fetch here is best-effort: a failure contributes nothing.
import { fetchArticles, inWindow, IL_NEWS_DOMAINS } from './ilnews.js'
import { openaiSearch, hostOf } from './openai.js'
import { askWithSearch } from './llm.js'
import { logEvent } from './validate.js'
import { tidyUrl, URL_RE } from './sources.js'

export const DEFAULT_RESEARCH_MODEL = 'gpt-5.4-mini'
const UA = { 'User-Agent': 'Mozilla/5.0 (StocksInsights)' }
const SEC_UA = { 'User-Agent': 'KalStocks research lior.belhassen@gmail.com' }
const DAY = 86_400_000
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10)

// Yahoo sector/industry → benchmark that measures the whole sector, the Hebrew name of its stocks
// (`group`), the news search phrase (`query`, defaults to `group`) and a title test for it.
const IL_SECTORS = [
  { test: (s, i) => /^Banks/.test(i), symbol: 'TA-BANKS.TA', label: 'מדד הבנקים', group: 'מניות הבנקים', re: /בנק/ },
  { test: (s, i) => /Insurance/.test(i) || (s === 'Financial Services' && !/Banks/.test(i)), symbol: 'TA-INS.TA', label: 'מדד הביטוח והפיננסים', group: 'מניות הביטוח', re: /ביטוח|פיננס/ },
  { test: (s, i) => /Aerospace & Defense/.test(i), symbol: '207.TA', label: 'מדד הביטחוניות', group: 'מניות הביטחוניות', re: /ביטחונ|אלביט/ },
  { test: (s, i) => /Engineering & Construction|Building/.test(i), symbol: '55.TA', label: 'מדד הבנייה', group: 'מניות הבנייה', re: /בני[יה]|קבלנ/ },
  { test: (s) => s === 'Real Estate', symbol: 'ESTATE15.TA', label: 'מדד הנדל"ן', group: 'מניות הנדל"ן', re: /נדל["״]?ן/ },
  { test: (s) => s === 'Technology' || s === 'Communication Services', symbol: 'TA-TECH.TA', label: 'מדד הטכנולוגיה', group: 'מניות הטכנולוגיה', re: /טכנולוג|הייטק|שבבים/ },
  { test: (s) => s === 'Healthcare', symbol: 'TASEBM.TA', label: 'מדד הביומד', group: 'מניות הביומד', re: /ביומד|פארמה|תרופ/ },
  { test: (s, i) => /Airlines|Airports/.test(i), symbol: null, label: 'מניות התעופה', group: 'מניות התעופה', re: /תעופה|טיס|אל על|ישראייר|ארקיע/ },
]
const US_SECTORS = [
  { test: (s, i) => /Semiconductor/.test(i), symbol: 'SMH', label: 'מדד השבבים (SMH)', group: 'מניות השבבים', query: 'chip stocks', re: /chip|semiconductor/i },
  { test: (s) => s === 'Technology', symbol: 'XLK', label: 'ענף הטכנולוגיה (XLK)', group: 'מניות הטכנולוגיה', query: 'tech stocks', re: /tech/i },
  { test: (s, i) => /Banks/.test(i), symbol: 'KBE', label: 'ענף הבנקים (KBE)', group: 'מניות הבנקים', query: 'bank stocks', re: /bank/i },
  { test: (s) => s === 'Financial Services', symbol: 'XLF', label: 'ענף הפיננסים (XLF)', group: 'מניות הפיננסים', query: 'financial stocks', re: /financ|insur|bank/i },
  { test: (s) => s === 'Healthcare', symbol: 'XLV', label: 'ענף הבריאות (XLV)', group: 'מניות הבריאות', query: 'healthcare stocks', re: /health|pharma|drug|biotech/i },
  { test: (s) => s === 'Consumer Cyclical', symbol: 'XLY', label: 'ענף הצריכה (XLY)', group: 'מניות הצריכה', query: 'consumer stocks', re: /consumer|retail/i },
  { test: (s) => s === 'Communication Services', symbol: 'XLC', label: 'ענף התקשורת (XLC)', group: 'מניות התקשורת', query: 'communication stocks', re: /media|communication|internet/i },
  { test: (s) => s === 'Energy', symbol: 'XLE', label: 'ענף האנרגיה (XLE)', group: 'מניות האנרגיה', query: 'energy stocks', re: /energy|oil/i },
  { test: (s, i) => /Airlines/.test(i), symbol: 'JETS', label: 'ענף התעופה (JETS)', group: 'מניות התעופה', query: 'airline stocks', re: /airline|carrier|flight/i },
  { test: (s) => s === 'Industrials', symbol: 'XLI', label: 'ענף התעשייה (XLI)', group: 'מניות התעשייה', query: 'industrial stocks', re: /industrial/i },
  { test: (s) => s === 'Consumer Defensive', symbol: 'XLP', label: 'ענף מוצרי הצריכה הבסיסיים (XLP)', group: 'מניות מוצרי הצריכה', query: 'consumer staples', re: /staples|consumer/i },
  { test: (s) => s === 'Utilities', symbol: 'XLU', label: 'ענף התשתיות (XLU)', group: 'מניות התשתיות', query: 'utility stocks', re: /utilit/i },
  { test: (s) => s === 'Real Estate', symbol: 'XLRE', label: 'ענף הנדל"ן (XLRE)', group: 'מניות הנדל"ן', query: 'REITs', re: /REIT|real estate/i },
  { test: (s) => s === 'Basic Materials', symbol: 'XLB', label: 'ענף חומרי הגלם (XLB)', group: 'מניות חומרי הגלם', query: 'materials stocks', re: /material|metal|mining|chemical/i },
]

/** Sector benchmark for a Yahoo profile: { symbol, label, group, re, role: 'sector' } or null (symbol null = news-only sector). */
export function sectorBenchmark({ market, sector, industry }) {
  if (!sector && !industry) return null
  const hit = (market === 'US' ? US_SECTORS : IL_SECTORS).find((x) => x.test(sector || '', industry || ''))
  return hit ? { symbol: hit.symbol, label: hit.label, group: hit.group, query: hit.query || hit.group, re: hit.re, role: 'sector' } : null
}

const HEBREW_RE = /[\u0590-\u05FF]/

/** The Hebrew press name in a model's one-line answer ('"אל על"' → 'אל על'), or null. */
export function cleanHebrewName(text) {
  const line = String(text || '').split('\n').map((l) => l.replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/https?:\/\/\S+|\([^)]*\)|\[[^\]]*\]|[*`]/g, '').trim()).find(Boolean) || ''
  const name = line.replace(/^["'״׳“”\s]+|["'״׳“”.\s]+$/g, '').replace(/^(מניית|מניות|חברת)\s+/, '').trim()
  return HEBREW_RE.test(name) && !/[A-Za-z]/.test(name) && name.length <= 30 && name.split(/\s+/).length <= 4 ? name : null
}

/**
 * Hebrew name of a TASE security saved under Yahoo's English name ("EL AL ISRAEL AIRLI" → "אל על").
 * Israeli financial press only uses the Hebrew name, so research by the English one finds nothing.
 */
export async function hebrewName({ symbol, englishName }, keys, { ask = askWithSearch } = {}) {
  const prompt = `מה השם העברי שבו גלובס, כלכליסט וביזפורטל כותבים על נייר הערך הנסחר בבורסת תל אביב בסימול ${symbol}${englishName ? ` (${englishName})` : ''}? ענה בשורה אחת: השם העברי בלבד, בלי "מניית" או "חברת" ובלי הסבר.`
  return cleanHebrewName((await ask(prompt, keys, { temperature: 0 })).text)
}

/** Yahoo Finance search: sector/industry/English name, plus Yahoo's company news list. */
export async function fetchProfile(symbol, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=10`, { headers: UA })
  if (!r.ok) throw new Error(`Yahoo search HTTP ${r.status}`)
  const d = await r.json()
  const q = (d.quotes || []).find((x) => x.symbol === symbol)
  return { sector: q?.sector || null, industry: q?.industry || null, name: q?.longname || q?.shortname || null, news: d.news || [] }
}

/** Yahoo company news → articles (only items Yahoo tags with this ticker). */
export function yahooNewsArticles(news = [], { symbol, period = 'day', window = null, now = Date.now() }) {
  return news
    .filter((n) => n?.title && n.providerPublishTime && (n.relatedTickers || []).includes(symbol))
    .map((n) => {
      const at = n.providerPublishTime * 1000
      return { title: n.title, source: n.publisher || 'Yahoo Finance', host: hostOf(n.link) || 'finance.yahoo.com', at, date: ymd(at), url: n.link, kind: 'company' }
    })
    .filter((a) => inWindow(a, { period, window, now }))
}

const ITEM_HE = {
  '1.01': 'הסכם מהותי', '1.02': 'סיום הסכם מהותי', '2.01': 'השלמת רכישה או מכירה', '2.02': 'תוצאות כספיות', '2.05': 'תוכנית התייעלות',
  '2.06': 'מחיקת נכסים', '3.02': 'הנפקת מניות', '5.02': 'שינויים בהנהלה או בדירקטוריון', '5.07': 'הצבעת בעלי מניות', '7.01': 'הודעה למשקיעים', '8.01': 'אירוע מהותי אחר',
}

/** SEC EDGAR 8-K filings of a US company inside the period (EDGAR accepts the ticker as CIK). */
export async function fetchSecFilings({ symbol, period = 'day', window = null, now = Date.now(), fetchImpl = fetch }) {
  const r = await fetchImpl(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(symbol)}&type=8-K&dateb=&owner=include&count=10&output=atom`, { headers: SEC_UA })
  if (!r.ok) throw new Error(`SEC HTTP ${r.status}`)
  return parseSecAtom(await r.text())
    .filter((a) => (period !== 'day' && window?.startDate ? inWindow(a, { period, window, now }) : a.at >= now - 3 * DAY && a.at <= now + DAY))
}

export function parseSecAtom(xml) {
  return [...String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1]
    const date = e.match(/<filing-date>([^<]+)</)?.[1]
    const url = e.match(/<filing-href>([^<]+)</)?.[1]
    const type = e.match(/<filing-type>([^<]+)</)?.[1] || '8-K'
    const items = [...(e.match(/<items-desc>([^<]*)</)?.[1] || '').matchAll(/\d\.\d\d/g)].map((x) => x[0]).filter((i) => i !== '9.01')
    const what = items.map((i) => ITEM_HE[i]).filter(Boolean)
    return date && url ? { title: `דיווח רשמי לרשות ניירות הערך האמריקאית (טופס ${type})${what.length ? `: ${what.join(', ')}` : ''}`, source: 'SEC', host: 'sec.gov', at: Date.parse(`${date}T21:00:00Z`), date, url: url.replace(/&amp;/g, '&'), kind: 'official' } : null
  }).filter(Boolean)
}

const coreName = (n) => String(n || '').replace(/,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Holdings?|Ltd\.?|plc|N\.V\.|S\.A\.|Group|Limited|\/[A-Z]+\/?)$/gi, '').replace(/,?\s+(Inc\.?|Corp\.?|Ltd\.?)$/i, '').trim()

/** Google News searches beyond the instrument's own name: English name, sector, market wrap-up. */
export function researchQueries({ market, isIndex = false, profile = null, sector = null }) {
  const out = []
  if (market === 'US') {
    const name = coreName(profile?.name)
    if (!isIndex && name && name.length >= 3) {
      const re = new RegExp(name.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      out.push({ query: `"${name}" (stock OR shares OR analyst)`, relevant: (t) => re.test(t), kind: 'company' })
    }
    if (sector) out.push({ query: `"${sector.query}"`, relevant: (t) => sector.re.test(t), kind: 'sector' })
    out.push({ query: '("stock market today" OR "stocks close" OR "Wall Street" OR "Dow" OR "S&P 500")', relevant: (t) => /stock|Wall Street|Dow|S&P|Nasdaq/i.test(t), kind: 'wrap' })
  } else {
    if (sector) out.push({ query: `"${sector.query}"`, relevant: (t) => sector.re.test(t), kind: 'sector' })
    if (!isIndex) out.push({ query: '(נעילה OR "סיכום המסחר" OR "בורסת תל אביב") (ת"א OR בורסה)', relevant: (t) => /ת["״]א|תל אביב|בורס|נעיל/.test(t), kind: 'wrap' })
  }
  return out
}

/**
 * All pre-fetched evidence for one move. Resolves { profile, sector, articles } — articles ordered
 * official → company → sector → wrap (see fetchArticles), deduplicated, at most `limit`.
 */
export async function gatherEvidence({ nameHe, symbol, isIndex = false, market, period = 'day', window = null, now = Date.now(), limit = 14, fetchImpl = fetch }) {
  const profile = isIndex ? null : await fetchProfile(symbol, { fetchImpl }).catch((e) => { logEvent('warn', { stage: 'research', source: 'yahoo-profile', symbol, error: e.message }); return null })
  const sector = profile ? sectorBenchmark({ market, ...profile }) : null
  const [news, filings] = await Promise.all([
    fetchArticles({ nameHe, symbol, isIndex, market, period, window, now, limit, extraQueries: researchQueries({ market, isIndex, profile, sector }), fetchImpl }).catch(() => []),
    market === 'US' && !isIndex ? fetchSecFilings({ symbol, period, window, now, fetchImpl }).catch((e) => { logEvent('warn', { stage: 'research', source: 'sec', symbol, error: e.message }); return [] }) : [],
  ])
  const yahoo = profile ? yahooNewsArticles(profile.news, { symbol, period, window, now }) : []
  const seen = new Set()
  const articles = [...filings, ...yahoo.slice(0, 4), ...news]
    .filter((a) => { const k = a.title.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, limit)
  return { profile, sector, articles }
}

/** Where the drafter must look, by market. */
// Moves that differ from the market usually have a concrete trigger outside the company's own filings.
const EVENTS_LINE = 'אירועים חריגים שנוגעים לחברה, למתחריה או לענף שלה באותו זמן, גם בלי דיווח רשמי: תקריות ביטחוניות או תעופתיות, תאונות, שביתות, תקלות, החלטות רגולציה, מכרזים, ואירועים אצל מתחרים (למשל תקרית אצל חברה מתחרה שמסיטה אליה לקוחות). כשהנייר זז שונה מהשוק, חפש אירוע כזה לפני שאתה מייחס את התנועה לשוק.'

export function researchInstructions({ market, isIndex = false, sector = null, when }) {
  const sectorLine = sector ? ` (${sector.label})` : ''
  if (market === 'US') {
    return isIndex
      ? `חקור לעומק, באנגלית ובעברית: סיכומי המסחר בוול סטריט ${when} (Reuters, CNBC, Bloomberg, MarketWatch, AP), נתוני מאקרו שפורסמו (אינפלציה, תעסוקה, ריבית הפד, תשואות האג"ח), דוחות של החברות הגדולות במדד ותנועות ענפיות בולטות.`
      : `חקור לעומק, באנגלית ובעברית, לפי הסדר:
1. דיווחים רשמיים של החברה ${when}: טפסי 8-K ב-SEC (sec.gov), הודעות לעיתונות (Business Wire, PR Newswire, GlobeNewswire), אתר קשרי המשקיעים, דוחות רבעוניים ותחזיות.
2. ${EVENTS_LINE}
3. שינויי המלצה ומחיר יעד של אנליסטים, וכתבות על החברה ב-Reuters, CNBC, Bloomberg, MarketWatch, Barron's, Yahoo Finance.
4. מה עשו הענף${sectorLine} והמניות המתחרות באותו זמן, ולמה.
5. סיכום המסחר בוול סטריט ${when} ונתוני מאקרו (ריבית, תשואות, אינפלציה).`
  }
  return isIndex
    ? `חקור לעומק, בעברית ובאנגלית: סיכומי המסחר בבורסת תל אביב ${when} בגלובס, כלכליסט, ביזפורטל ו-TheMarker (כתבות "נעילה" ו"סיכום המסחר"), המניות הגדולות שהובילו את המדד, מה עשו וול סטריט והחוזים העתידיים, ונתוני מאקרו בישראל (ריבית בנק ישראל, אינפלציה, שער הדולר).`
    : `חקור לעומק, בעברית ובאנגלית, לפי הסדר:
1. דיווחים רשמיים של החברה ${when}: מערכת מאיה של הבורסה (maya.tase.co.il), אתר קשרי המשקיעים של החברה, דוחות כספיים והודעות לעיתונות; לחברה דואלית גם דיווחים ל-SEC.
2. ${EVENTS_LINE}
3. כתבות על החברה בגלובס, כלכליסט, ביזפורטל, TheMarker ו-Google News, כולל המלצות ומחירי יעד של אנליסטים ובתי השקעות.
4. מה עשו הענף${sectorLine} והמניות המקבילות באותו זמן, ולמה.
5. סיכום המסחר בבורסת תל אביב ${when} (כתבות "נעילה" / "סיכום המסחר"), מה עשו וול סטריט והחוזים העתידיים, ונתוני מאקרו (ריבית, אינפלציה, שער הדולר).`
}

/** Output format of the drafter: dated, linked findings first, then the explanation. */
export const FINDINGS_FORMAT = `ממצאים:
- <YYYY-MM-DD> | <מה קרה, במשפט אחד בעברית> | <כתובת URL מלאה של המקור שמצאת>
(3-6 ממצאים מהתקופה הרלוונטית בלבד, או "- אין")`

/**
 * Findings the drafter listed, kept only when the URL is one its search actually returned and the
 * date is inside the period (an older event is not the reason for today's move).
 */
export function parseFindings(text, { urls = [], period = 'day', window = null, now = Date.now() } = {}) {
  const block = String(text || '').match(/ממצאים:?\s*\n([\s\S]*?)(?:\n\s*(?:ביטחון|סנטימנט|הסבר|הערכה):)/)?.[1] || ''
  const hosts = new Set(urls.map(hostOf).filter(Boolean))
  return block.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).map((l) => {
    const url = tidyUrl(l.match(URL_RE)?.[0])
    const [dateRaw, claim] = l.split('|').map((x) => x.trim())
    const at = Date.parse(dateRaw)
    if (!url || !claim || !Number.isFinite(at)) return null
    const host = hostOf(url)
    return hosts.has(host) ? { title: claim.replace(/https?:\/\/\S+/g, '').trim(), source: host, host, at: at + 12 * 3600_000, date: ymd(at), url, kind: 'research' } : null
  }).filter((a) => a && (period !== 'day' && window?.startDate ? inWindow(a, { period, window, now }) : a.at >= now - 3 * DAY && a.at <= now + DAY))
}

/** Deep, search-heavy draft: OpenAI with more reasoning (several searches), else the usual chain. */
export async function researchDraft(prompt, keys = {}, { effort = 'medium' } = {}) {
  if (keys.openaiKey) return openaiSearch(prompt, keys.openaiKey, keys.openaiResearchModel || DEFAULT_RESEARCH_MODEL, { effort })
  return askWithSearch(prompt, keys, { temperature: 0.3 })
}

const OFFICIAL_IL_DOMAINS = ['maya.tase.co.il', 'tase.co.il', 'themarker.com']

/** Domains the checker may search: Israeli press + official sources + wherever the findings came from (US: unrestricted). */
export function checkerDomains(market, findings = []) {
  if (market === 'US') return null
  return [...new Set([...IL_NEWS_DOMAINS, ...OFFICIAL_IL_DOMAINS, ...findings.map((f) => f.host).filter(Boolean)])].slice(0, 20)
}
