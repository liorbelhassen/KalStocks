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
]

const KIND_LABEL = { index: 'מדד', equity: 'מניה', etf: 'קרן סל' }
export const kindLabel = (k) => KIND_LABEL[k] || ''

// Normalize for matching: lowercase, strip quotes/dashes/spaces so "ת\"א 35", "תא 35",
// "תא35" and "35" all match consistently.
const norm = (s) => (s || '').toLowerCase().replace(/["'`״׳\-\s]/g, '')

export function searchCatalog(queryStr, { excludeSymbols = [] } = {}) {
  const q = norm(queryStr)
  if (!q) return []
  const excluded = new Set(excludeSymbols)
  return CATALOG.filter((item) => {
    if (excluded.has(item.symbol)) return false
    const hay = norm([item.nameHe, item.symbol, ...(item.aliases || [])].join(' '))
    return hay.includes(q)
  }).slice(0, 12)
}
