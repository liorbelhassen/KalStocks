// Source attributions for an explanation: each is { name, url } — a short site name linking to the
// exact article/filing it came from. Older records store bare hosts or 'Yahoo Finance'.
import { hostOf } from './openai.js'

const SITE_NAMES = {
  'globes.co.il': 'גלובס',
  'calcalist.co.il': 'כלכליסט',
  'bizportal.co.il': 'ביזפורטל',
  'themarker.com': 'TheMarker',
  'maya.tase.co.il': 'מאי"ה',
  'tase.co.il': 'הבורסה לתל אביב',
  'news.google.com': 'Google News',
  'finance.yahoo.com': 'Yahoo Finance',
  'reuters.com': 'Reuters',
  'cnbc.com': 'CNBC',
  'bloomberg.com': 'Bloomberg',
  'marketwatch.com': 'MarketWatch',
  'barrons.com': "Barron's",
  'wsj.com': 'WSJ',
  'apnews.com': 'AP',
  'sec.gov': 'SEC',
  'investing.com': 'Investing.com',
  'ynet.co.il': 'ynet',
  'themarker.co.il': 'TheMarker',
  'passportnews.co.il': 'PassportNews',
  'walla.co.il': 'וואלה',
  'ice.co.il': 'אייס',
  'maariv.co.il': 'מעריב',
  'sponser.co.il': 'ספונסר',
  'mako.co.il': 'mako',
  'n12.co.il': 'N12',
  'haaretz.co.il': 'הארץ',
  'israelhayom.co.il': 'ישראל היום',
  'kan.org.il': 'כאן',
  'i24news.tv': 'i24NEWS',
  'jdn.co.il': 'JDN',
  'tradingview.com': 'TradingView',
}

// URLs as written in model text: stop at whitespace/brackets/quotes; drop trailing punctuation.
export const URL_RE = /https?:\/\/[^\s)\]>|`'"<]+/
export const tidyUrl = (u) => (u ? String(u).replace(/[)\].,;:>`'"״]+$/, '').replace(/[?&]utm_source=openai$/, '') : u)

const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '')
export function siteName(host) {
  const h = bare(host)
  for (let d = h; d.includes('.'); d = d.slice(d.indexOf('.') + 1)) if (SITE_NAMES[d]) return SITE_NAMES[d]
  return h
}
export const yahooQuoteUrl = (symbol) => (symbol ? `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}` : null)

export function sourceLinks(sources = [], symbol = null) {
  const out = []
  const seen = new Set()
  for (const s of sources || []) {
    let name = ''
    let url = null
    if (s && typeof s === 'object') { url = tidyUrl(s.url) || null; name = s.name || siteName(hostOf(url || '')) }
    else if (s === 'Yahoo Finance') { name = s; url = yahooQuoteUrl(symbol) }
    else if (/^[\w-]+(\.[\w-]+)+$/.test(String(s || ''))) { name = siteName(s); url = `https://${bare(s)}` }
    else name = String(s || '')
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({ name, url: /^https?:\/\//.test(url || '') ? url : null })
  }
  return out
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const sourcesHtml = (sources, symbol) =>
  sourceLinks(sources, symbol).map(({ name, url }) => (url ? `<a href="${esc(url)}" style="color:#0969da;text-decoration:underline;">${esc(name)}</a>` : esc(name))).join(', ')
