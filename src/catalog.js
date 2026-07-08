// Searchable catalog of TASE instruments for the autocomplete.
// `symbol`      — unique instrument id (also the Yahoo ticker for equities/index).
// `priceSymbol` — the Yahoo symbol we actually fetch prices for. ETFs (קרנות סל) are not on
//                 Yahoo, so they are proxied to the TA-35 index (see PROJECT_MEMORY §3).
// `aliases`     — extra search terms (spelling variants, EN names). Security numbers are
//                 deliberately NOT included — search is by name only.
// All symbols verified on Yahoo (2026-07).

export const CATALOG = [
  // Index
  { symbol: 'TA35.TA', nameHe: 'מדד ת"א 35', kind: 'index', priceSymbol: 'TA35.TA',
    aliases: ['תא 35', 'תל אביב 35', 'מעוף', 'מעו"ף', 'ta35', 'ta-35', 'index'] },

  // TA-35 tracking ETFs (קרנות סל) — priced via the index
  { symbol: 'ETF-KSM-TA35', nameHe: 'קסם ת"א 35', kind: 'etf', priceSymbol: 'TA35.TA',
    aliases: ['קסם', 'תא 35', 'תל אביב 35', 'קרן סל', 'תעודת סל', 'ksm', 'kesem'] },
  { symbol: 'ETF-HRL-TA35', nameHe: 'הראל סל ת"א 35', kind: 'etf', priceSymbol: 'TA35.TA',
    aliases: ['הראל', 'תא 35', 'קרן סל', 'תעודת סל', 'harel'] },
  { symbol: 'ETF-MOR-TA35', nameHe: 'מור סל ת"א 35', kind: 'etf', priceSymbol: 'TA35.TA',
    aliases: ['מור', 'תא 35', 'קרן סל', 'תעודת סל', 'mor'] },
  { symbol: 'ETF-MTF-TA35', nameHe: 'MTF סל ת"א 35', kind: 'etf', priceSymbol: 'TA35.TA',
    aliases: ['תא 35', 'קרן סל', 'תעודת סל', 'mtf', 'migdal'] },
  { symbol: 'ETF-TCL-TA35', nameHe: 'תכלית ת"א 35', kind: 'etf', priceSymbol: 'TA35.TA',
    aliases: ['תכלית', 'תא 35', 'קרן סל', 'תעודת סל', 'tachlit'] },

  // Equities (Yahoo ticker == symbol == priceSymbol)
  { symbol: 'POLI.TA', nameHe: 'בנק הפועלים', kind: 'equity', priceSymbol: 'POLI.TA', aliases: ['הפועלים', 'פועלים', 'בנק', 'hapoalim', 'bank'] },
  { symbol: 'LUMI.TA', nameHe: 'בנק לאומי', kind: 'equity', priceSymbol: 'LUMI.TA', aliases: ['לאומי', 'בנק', 'leumi'] },
  { symbol: 'MZTF.TA', nameHe: 'מזרחי טפחות', kind: 'equity', priceSymbol: 'MZTF.TA', aliases: ['מזרחי', 'טפחות', 'בנק', 'mizrahi', 'tefahot'] },
  { symbol: 'DSCT.TA', nameHe: 'בנק דיסקונט', kind: 'equity', priceSymbol: 'DSCT.TA', aliases: ['דיסקונט', 'בנק', 'discount'] },
  { symbol: 'FIBI.TA', nameHe: 'הבנק הבינלאומי', kind: 'equity', priceSymbol: 'FIBI.TA', aliases: ['בינלאומי', 'בנק', 'fibi'] },
  { symbol: 'TEVA.TA', nameHe: 'טבע', kind: 'equity', priceSymbol: 'TEVA.TA', aliases: ['תרופות', 'פארמה', 'teva'] },
  { symbol: 'NICE.TA', nameHe: 'נייס', kind: 'equity', priceSymbol: 'NICE.TA', aliases: ['nice'] },
  { symbol: 'ESLT.TA', nameHe: 'אלביט מערכות', kind: 'equity', priceSymbol: 'ESLT.TA', aliases: ['אלביט', 'ביטחון', 'elbit'] },
  { symbol: 'ICL.TA', nameHe: 'כיל', kind: 'equity', priceSymbol: 'ICL.TA', aliases: ['כימיקלים לישראל', 'icl'] },
  { symbol: 'BEZQ.TA', nameHe: 'בזק', kind: 'equity', priceSymbol: 'BEZQ.TA', aliases: ['תקשורת', 'bezeq'] },
  { symbol: 'TSEM.TA', nameHe: 'טאואר', kind: 'equity', priceSymbol: 'TSEM.TA', aliases: ['טאוור', 'שבבים', 'tower', 'semiconductor'] },
  { symbol: 'NVMI.TA', nameHe: 'נובה', kind: 'equity', priceSymbol: 'NVMI.TA', aliases: ['nova'] },
  { symbol: 'ENOG.TA', nameHe: "אנרג'יאן", kind: 'equity', priceSymbol: 'ENOG.TA', aliases: ['אנרגיאן', 'גז', 'energean'] },
  { symbol: 'AZRG.TA', nameHe: 'עזריאלי', kind: 'equity', priceSymbol: 'AZRG.TA', aliases: ['נדל"ן', 'azrieli'] },

  // ── USA ── (Yahoo prices US tickers directly; US ETFs like SPY/QQQ are priced, not proxied)
  { symbol: '^GSPC', nameHe: 'מדד S&P 500', kind: 'index', priceSymbol: '^GSPC', market: 'US', aliases: ['sp500', 's&p', 'ספי', 'אס אנד פי'] },
  { symbol: '^IXIC', nameHe: 'נאסד"ק', kind: 'index', priceSymbol: '^IXIC', market: 'US', aliases: ['nasdaq', 'נאסדק'] },
  { symbol: '^DJI', nameHe: "דאו ג'ונס", kind: 'index', priceSymbol: '^DJI', market: 'US', aliases: ['dow', 'dowjones', 'דאו'] },
  { symbol: 'SPY', nameHe: 'S&P 500 ETF (SPY)', kind: 'etf', priceSymbol: 'SPY', market: 'US', aliases: ['spy', 'sp500'] },
  { symbol: 'QQQ', nameHe: 'נאסד"ק ETF (QQQ)', kind: 'etf', priceSymbol: 'QQQ', market: 'US', aliases: ['qqq', 'nasdaq'] },
  { symbol: 'AAPL', nameHe: 'אפל', kind: 'equity', priceSymbol: 'AAPL', market: 'US', aliases: ['apple', 'אייפון'] },
  { symbol: 'MSFT', nameHe: 'מיקרוסופט', kind: 'equity', priceSymbol: 'MSFT', market: 'US', aliases: ['microsoft'] },
  { symbol: 'GOOGL', nameHe: 'גוגל', kind: 'equity', priceSymbol: 'GOOGL', market: 'US', aliases: ['google', 'alphabet', 'אלפאבית'] },
  { symbol: 'AMZN', nameHe: 'אמזון', kind: 'equity', priceSymbol: 'AMZN', market: 'US', aliases: ['amazon'] },
  { symbol: 'NVDA', nameHe: 'אנבידיה', kind: 'equity', priceSymbol: 'NVDA', market: 'US', aliases: ['nvidia', 'שבבים'] },
  { symbol: 'TSLA', nameHe: 'טסלה', kind: 'equity', priceSymbol: 'TSLA', market: 'US', aliases: ['tesla', 'רכב'] },
  { symbol: 'META', nameHe: 'מטא', kind: 'equity', priceSymbol: 'META', market: 'US', aliases: ['meta', 'facebook', 'פייסבוק'] },
  { symbol: 'MSTR', nameHe: 'מיקרוסטרטג\'י', kind: 'equity', priceSymbol: 'MSTR', market: 'US', aliases: ['microstrategy', 'strategy', 'ביטקוין'] },
]

const KIND_LABEL = { index: 'מדד', equity: 'מניה', etf: 'קרן סל' }
export const kindLabel = (k) => KIND_LABEL[k] || ''

// Sector per instrument, for grouping the dashboard by category.
const SECTORS = {
  'TA35.TA': 'מדדים',
  'POLI.TA': 'בנקים', 'LUMI.TA': 'בנקים', 'MZTF.TA': 'בנקים', 'DSCT.TA': 'בנקים', 'FIBI.TA': 'בנקים',
  'TEVA.TA': 'פארמה', 'NICE.TA': 'טכנולוגיה', 'ESLT.TA': 'ביטחוניות', 'ICL.TA': 'כימיה',
  'BEZQ.TA': 'תקשורת', 'TSEM.TA': 'שבבים', 'NVMI.TA': 'שבבים', 'ENOG.TA': 'אנרגיה', 'AZRG.TA': 'נדל"ן',
  // USA
  '^GSPC': 'מדדים', '^IXIC': 'מדדים', '^DJI': 'מדדים', 'SPY': 'קרנות סל', 'QQQ': 'קרנות סל',
  'AAPL': 'טכנולוגיה', 'MSFT': 'טכנולוגיה', 'GOOGL': 'טכנולוגיה', 'AMZN': 'טכנולוגיה', 'META': 'טכנולוגיה',
  'NVDA': 'שבבים', 'TSLA': 'רכב', 'MSTR': 'קריפטו',
}
export const SECTOR_ORDER = ['מדדים', 'קרנות סל', 'בנקים', 'ביטוח', 'נדל"ן', 'טכנולוגיה', 'שבבים', 'רכב', 'קריפטו', 'פארמה', 'ביטחוניות', 'אנרגיה', 'כימיה', 'תקשורת', 'אחר']
export function sectorOf(symbol) {
  if ((symbol || '').startsWith('ETF-')) return 'קרנות סל'
  return SECTORS[symbol] || 'אחר'
}

// Normalize for matching: lowercase, strip quotes/dashes/dots/parens/spaces so "ת\"א 35",
// "תא 35", "קסם.תא 35", "תא35" and "35" all match consistently.
const norm = (s) => (s || '').toLowerCase().replace(/["'`״׳().[\]/\\\-\s]/g, '')
const tokenize = (s) =>
  (s || '').toLowerCase().replace(/["'`״׳().[\]/\\]/g, ' ').split(/\s+/).filter((t) => t.length >= 2)

export function searchCatalog(queryStr, { excludeSymbols = [], market } = {}) {
  const q = norm(queryStr)
  if (!q) return []
  const excluded = new Set(excludeSymbols)
  return CATALOG.filter((item) => {
    if (market && (item.market || 'IL') !== market) return false
    if (excluded.has(item.symbol)) return false
    const hay = norm([item.nameHe, item.symbol, ...(item.aliases || [])].join(' '))
    return hay.includes(q)
  }).slice(0, 12)
}

// Fuzzy match a (messy) broker name to a catalog instrument — for screenshot import.
// Tries substring first, then token overlap (handles "קסם.תא 35", "מו.סל תא 35", "דיסקונט א", …).
export function matchInstrument(name) {
  const q = norm(name)
  if (!q) return null
  for (const it of CATALOG) {
    const hay = norm([it.nameHe, it.symbol, ...(it.aliases || [])].join(' '))
    if (hay.includes(q) || q.includes(norm(it.nameHe))) return it
  }
  const qt = new Set(tokenize(name))
  if (!qt.size) return null
  let best = null
  let bestScore = 0
  for (const it of CATALOG) {
    const ht = new Set(tokenize([it.nameHe, ...(it.aliases || [])].join(' ')))
    let score = 0
    for (const t of qt) if (ht.has(t)) score++
    if (score > bestScore) {
      bestScore = score
      best = it
    }
  }
  // ≥2 shared tokens, or a single strong token when the name is short.
  if (bestScore >= 2) return best
  if (bestScore >= 1 && qt.size <= 2) return best
  return null
}
