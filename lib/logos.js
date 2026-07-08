// Instrument logos. Real company logos come from logo.dev (free, publishable token — works in
// browser and email). No token-free service returns real Israeli-company logos reliably
// (Clearbit shut down; Google/DuckDuckGo favicons return a gray globe or 404). So:
//   - equities        → real logo from logo.dev (via the corrected company domain)
//   - indices / ETFs  → country flag (all TASE here → Israel 🇮🇱)
// No letter monograms. If the token is missing, equities simply show no icon (never a globe/letter).
const FLAG_IL = '🇮🇱'

export const LOGO_DOMAINS = {
  'POLI.TA': 'bankhapoalim.co.il',
  'LUMI.TA': 'bankleumi.co.il',
  'MZTF.TA': 'mizrahi-tefahot.co.il',
  'DSCT.TA': 'discountbank.co.il',
  'FIBI.TA': 'fibi.co.il',
  'TEVA.TA': 'tevapharm.com',
  'NICE.TA': 'nice.com',
  'ESLT.TA': 'elbitsystems.com',
  'ICL.TA': 'icl-group.com',
  'BEZQ.TA': 'bezeq.co.il',
  'TSEM.TA': 'towersemi.com',
  'NVMI.TA': 'novami.com',
  'ENOG.TA': 'energean.com',
  'AZRG.TA': 'azrieli.com',
}

export const isFlag = (symbol, { kind, isIndex } = {}) =>
  Boolean(isIndex || kind === 'index' || kind === 'etf')

export function logoUrl(symbol, token, size = 128) {
  const d = LOGO_DOMAINS[symbol]
  if (!d || !token) return null
  return `https://img.logo.dev/${d}?token=${token}&size=${size}&format=png&retina=true`
}

// Inline HTML badge for emails: flag for indices/ETFs, <img> logo for equities, else nothing.
export function badgeHtml(symbol, nameHe, opts, token, size = 18) {
  if (isFlag(symbol, opts)) {
    return `<span style="font-size:${size + 2}px;vertical-align:middle;margin-left:6px;">${FLAG_IL}</span>`
  }
  const u = logoUrl(symbol, token, 64)
  return u
    ? `<img src="${u}" width="${size}" height="${size}" alt="" style="border-radius:4px;background:#fff;vertical-align:middle;margin-left:6px;">`
    : ''
}

export const FLAG = FLAG_IL
