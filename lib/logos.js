// Real company logos, bundled locally in public/logos/<TICKER>.png (sourced from Wikipedia/
// Wikidata and verified). Served from Firebase Hosting → work in the dashboard and in email.
// No token, no runtime API, no letter monograms. Indices/ETFs show the country flag.
const FLAG_IL = '🇮🇱'
export const PUBLIC_BASE = 'https://kalstocks1.web.app'

// Tickers that have a bundled real logo file (public/logos/<key>.png). key = symbol without ".TA".
const BUNDLED = new Set([
  'POLI', 'LUMI', 'MZTF', 'DSCT', 'FIBI', 'TEVA', 'NICE', 'ESLT', 'BEZQ', 'TSEM', 'NVMI', 'ENOG',
])

export const isFlag = (symbol, { kind, isIndex } = {}) =>
  Boolean(isIndex || kind === 'index' || kind === 'etf')

// base='' → relative path for the dashboard; base=PUBLIC_BASE → absolute URL for emails.
export function logoUrl(symbol, base = '') {
  const key = (symbol || '').replace(/\.TA$/, '')
  return BUNDLED.has(key) ? `${base}/logos/${key}.png` : null
}

// Inline HTML badge for emails: flag for indices/ETFs, bundled <img> logo for equities, else nothing.
export function badgeHtml(symbol, nameHe, opts, size = 18) {
  if (isFlag(symbol, opts)) {
    return `<span style="font-size:${size + 2}px;vertical-align:middle;margin-left:6px;">${FLAG_IL}</span>`
  }
  const u = logoUrl(symbol, PUBLIC_BASE)
  return u
    ? `<img src="${u}" width="${size}" height="${size}" alt="" style="border-radius:4px;background:#fff;object-fit:contain;vertical-align:middle;margin-left:6px;">`
    : ''
}

export const FLAG = FLAG_IL
