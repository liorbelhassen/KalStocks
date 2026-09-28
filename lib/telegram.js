// Real-time news context from public Telegram channels (via t.me/s/<channel> — no auth needed).
// Injected into the insight prompts so explanations are grounded in what is ACTUALLY happening
// right now, instead of the model's trained-in assumptions (which caused hallucinations like
// "rocket fire from Gaza"). Channels are configurable via the TELEGRAM_CHANNELS env var.
import { logEvent } from './validate.js'
import { CATALOG } from '../src/catalog.js'

const DEFAULT_CHANNELS = (typeof process !== 'undefined' && process.env && process.env.TELEGRAM_CHANNELS
  ? process.env.TELEGRAM_CHANNELS
  : 'amitsegal,abualiexpress,hotstocksshells,globesnews,calcalist')
  .split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean)

function stripHtml(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Fetch recent posts from each channel. Returns a flat array of "[channel] text" strings (newest
// last per channel). Tolerates individual channel failures.
export async function fetchTelegramNews(channels = DEFAULT_CHANNELS, { perChannel = 6, maxChars = 200 } = {}) {
  const results = await Promise.all(
    channels.map(async (ch) => {
      try {
        const r = await fetch(`https://t.me/s/${ch}`, { headers: { 'User-Agent': 'Mozilla/5.0 (StocksInsights)' } })
        if (!r.ok) { logEvent('warn', { stage: 'news', source: `telegram:${ch}`, error: `HTTP ${r.status}` }); return [] }
        const html = await r.text()
        const posts = [...html.matchAll(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g)]
          .map((m) => stripHtml(m[1]))
          .filter((t) => t && t.length > 15)
        if (!posts.length) logEvent('warn', { stage: 'news', source: `telegram:${ch}`, error: 'no posts parsed (page layout changed?)' })
        return posts.slice(-perChannel).map((t) => `[${ch}] ${t.slice(0, maxChars)}`)
      } catch (e) {
        logEvent('warn', { stage: 'news', source: `telegram:${ch}`, error: String(e) })
        return []
      }
    }),
  )
  return results.flat()
}

// Investing.com Hebrew RSS — structured financial headlines (company news, raisings, ratings).
export async function fetchInvestingRss({ limit = 10, maxChars = 200 } = {}) {
  try {
    const r = await fetch('https://il.investing.com/rss/news.rss', { headers: { 'User-Agent': 'Mozilla/5.0 (StocksInsights)' } })
    if (!r.ok) { logEvent('warn', { stage: 'news', source: 'investing', error: `HTTP ${r.status}` }); return [] }
    const xml = await r.text()
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, limit)
      .map((m) => (m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '')
      .map((t) => t.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 12)
      .map((t) => `[investing] ${t.slice(0, maxChars)}`)
  } catch (e) {
    logEvent('warn', { stage: 'news', source: 'investing', error: String(e) })
    return []
  }
}

/** All current headlines (Telegram + Investing) as a flat array; logs when every source failed. */
export async function fetchHeadlines(channels) {
  const [tg, inv] = await Promise.all([fetchTelegramNews(channels), fetchInvestingRss()])
  const items = [...tg, ...inv]
  if (!items.length) logEvent('error', { stage: 'news', error: 'no headlines from any source — prompts run without live context' })
  return items
}

// Sector-level aliases ("בנק", "שבבים", "insurance"…) match too many unrelated headlines — only
// instrument-specific terms count as a company match.
const norm = (s) => String(s || '').toLowerCase().replace(/["'`״׳().[\]/\\-]/g, '')
const GENERIC_TERMS = new Set(['בנק', 'bank', 'שבבים', 'ביטוח', 'insurance', 'נדל"ן', 'גז', 'תקשורת', 'תרופות', 'פארמה', 'ביטחון', 'semiconductor', 'זיכרון', 'sp500', 'nasdaq', 'מדד'].map(norm))

/** Search terms that identify one instrument in a headline (name, non-generic aliases, ticker root). */
export function instrumentTerms({ nameHe, symbol, aliases }) {
  const cat = CATALOG.find((c) => c.symbol === symbol || c.priceSymbol === symbol)
  const root = String(symbol || '').replace(/\.TA$/i, '').replace(/^\^/, '')
  const terms = [nameHe, cat?.nameHe, ...(aliases || cat?.aliases || [])]
    .map(norm).filter((t) => t && t.length >= 3 && !GENERIC_TERMS.has(t))
  const stripped = [nameHe, cat?.nameHe].map((n) => norm(n).replace(/^(מדד|מניית|קרןסל|בנק)\s*/, '').trim()).filter((t) => t.length >= 3)
  if (root.length >= 4) terms.push(norm(root))
  return [...new Set([...terms, ...stripped])]
}

/** Headlines that mention this instrument (case/punctuation-insensitive). */
export function matchHeadlines(items, inst) {
  const terms = instrumentTerms(inst)
  if (!terms.length) return []
  return items.filter((h) => { const n = norm(h); return terms.some((t) => n.includes(t)) })
}

/**
 * Prompt-ready Hebrew context for ONE instrument.
 *  - IL instruments: the company's own headlines first, then the general Israeli market/geopolitics
 *    feed (a TASE-wide move usually has a macro/security cause).
 *  - US instruments: company headlines only. Israeli-politics Telegram posts are irrelevant to AAPL
 *    and pulled the model into explaining a US stock with Israeli news.
 * Returns '' when nothing relevant exists — the model then relies on its own web search.
 */
export function buildNewsContext(items, { market = 'IL', nameHe, symbol, aliases, maxGeneral = 25 } = {}) {
  if (!items?.length) return ''
  const own = matchHeadlines(items, { nameHe, symbol, aliases })
  const general = market === 'US' ? [] : items.filter((h) => !own.includes(h)).slice(0, maxGeneral)
  const lines = [
    ...own.map((n) => `- (על הנייר) ${n}`),
    ...general.map((n) => `- ${n}`),
  ]
  if (!lines.length) return ''
  return `\nכותרות חדשות עדכניות מהשעות האחרונות (ערוצי טלגרם + Investing — מקור אמת בזמן אמת):
${lines.join('\n')}
כותרות כלליות הן רקע בלבד: העובדה שאירוע (במיוחד ביטחוני) מופיע בחדשות אינה מוכיחה שהוא הזיז את השוק. התבסס רק על הכותרות הרלוונטיות לנייר הזה ולשוק שבו הוא נסחר. כותרות על חברות אחרות אינן רלוונטיות. אל תזכיר אירוע (במיוחד ביטחוני) שאינו מופיע בכותרות אלה או שלא אימתת בחיפוש.`
}

// Back-compat: the general (Israeli-market) context block, or ''.
export async function telegramContext(channels) {
  try {
    return buildNewsContext(await fetchHeadlines(channels), { market: 'IL' })
  } catch (e) {
    logEvent('error', { stage: 'news', error: String(e) })
    return ''
  }
}
