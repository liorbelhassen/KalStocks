// Measured cross-market context for AI explanations. The model gets hard numbers (what Wall Street,
// US futures, TA-35 and the shekel actually did) instead of guessing a story from headlines, and the
// fact-checker (lib/factcheck.js) holds the final text to these numbers.
import { marketOf } from './periods.js'
import { fetchSnapshot as yahooSnapshot } from './yahoo.js'

export const BENCHMARK_LABELS = {
  'TA35.TA': 'מדד ת"א 35',
  '^GSPC': 'S&P 500',
  '^IXIC': 'נאסד"ק',
  '^DJI': 'דאו ג\'ונס',
  'ES=F': 'החוזים העתידיים על S&P 500',
  'NQ=F': 'החוזים העתידיים על הנאסד"ק',
  'ILS=X': 'שער הדולר-שקל',
}

const US_INDEX = ['^GSPC', '^IXIC', '^DJI']
const isIlIndex = (symbol, isIndex) => symbol === 'TA35.TA' || (isIndex && marketOf(symbol) === 'IL')

/** Which instruments give context for a move in `symbol`, per period. */
export function benchmarksFor(symbol, { market, period = 'day' } = {}) {
  const us = (market || marketOf(symbol)) === 'US'
  let list
  if (period === 'day') list = us ? ['^GSPC', '^IXIC', '^DJI', 'NQ=F'] : ['TA35.TA', '^GSPC', '^IXIC', 'ES=F', 'NQ=F', 'ILS=X']
  else list = us ? ['^GSPC', '^IXIC'] : ['TA35.TA', '^GSPC', '^IXIC']
  return list.filter((s) => s !== symbol)
}

const MAX_DAY_AGE_MS = 4 * 86400000

/**
 * Fetch benchmark moves for the same day (latest session of each) or the same week/month window.
 * Resolves [{ symbol, label, changePct, asOf }]; benchmarks that fail or are stale are omitted.
 */
export async function fetchMarketFacts({ symbol, market, period = 'day', window = null, now = Date.now(), fetchSnapshot = yahooSnapshot } = {}) {
  const syms = benchmarksFor(symbol, { market, period })
  const opts = period === 'day' || !window ? { range: '1d' } : { interval: '1d', period1: (window.baseStart ?? window.start) / 1000, period2: window.end / 1000 }
  const settled = await Promise.allSettled(syms.map((s) => fetchSnapshot(s, opts)))
  const out = []
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') return
    const snap = r.value
    if (snap?.changePct == null || !Number.isFinite(snap.changePct)) return
    if (period === 'day' && snap.at && now - snap.at > MAX_DAY_AGE_MS) return
    out.push({ symbol: syms[i], label: BENCHMARK_LABELS[syms[i]] || syms[i], changePct: Math.round(snap.changePct * 100) / 100, asOf: snap.at || null })
  })
  return out
}

const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * Deterministic read of the numbers: does the instrument move with its market (market-wide), against
 * or far beyond it (instrument-specific), or is the move too small to explain?
 * Returns { kind: 'flat'|'market-wide'|'specific'|'mixed'|'unknown', ref: {label, changePct}|null }.
 */
export function diagnoseMove({ symbol, isIndex, changePct, facts = [] }) {
  if (changePct == null || !Number.isFinite(changePct)) return { kind: 'unknown', ref: null }
  const by = Object.fromEntries(facts.map((f) => [f.symbol, f]))
  let ref = null
  if (marketOf(symbol) === 'US') ref = US_INDEX.includes(symbol) ? by['^GSPC'] || by['^IXIC'] || null : by['^GSPC'] || null
  else if (isIlIndex(symbol, isIndex)) {
    const us = ['ES=F', 'NQ=F', '^GSPC', '^IXIC'].map((s) => by[s]).filter(Boolean)
    const fut = us.filter((f) => f.symbol.endsWith('=F'))
    const pick = fut.length ? fut : us
    if (pick.length) ref = { label: fut.length ? 'החוזים העתידיים בוול סטריט' : 'וול סטריט', changePct: Math.round(avg(pick.map((f) => f.changePct)) * 100) / 100 }
  } else ref = by['TA35.TA'] || null
  if (Math.abs(changePct) < 0.3) return { kind: 'flat', ref }
  if (!ref) return { kind: 'unknown', ref: null }
  const same = Math.sign(ref.changePct) === Math.sign(changePct)
  if (same && Math.abs(ref.changePct) >= 0.25 && Math.abs(ref.changePct) >= 0.4 * Math.abs(changePct)) return { kind: 'market-wide', ref }
  if (!same || Math.abs(changePct - ref.changePct) >= Math.max(1, Math.abs(changePct) * 0.6)) return { kind: 'specific', ref }
  return { kind: 'mixed', ref }
}

const fmtAsOf = (t) =>
  t ? new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(t)) : ''

/** Hebrew prompt block with the measured numbers + the deterministic diagnosis. '' when no facts. */
export function describeFacts({ facts = [], changePct, diagnosis, period = 'day', subjectLabel = 'הנייר' }) {
  if (!facts.length && changePct == null) return ''
  const lines = []
  if (changePct != null && Number.isFinite(changePct)) lines.push(`- ${subjectLabel}: ${signed(changePct)}`)
  for (const f of facts) lines.push(`- ${f.label}: ${signed(f.changePct)}${period === 'day' && f.asOf ? ` (נתון אחרון ${fmtAsOf(f.asOf)} שעון ישראל)` : ''}`)
  const ref = diagnosis?.ref
  const hint = {
    flat: 'התנועה קטנה מאוד — אל תבנה סביבה סיפור סיבתי.',
    'market-wide': ref && `התנועה תואמת את ${ref.label} (${signed(ref.changePct)}) — זו תנועה רוחבית של השוק, וזה חייב להיות הגורם המרכזי בהסבר. אסור לייחס אותה לאירוע אחר אלא אם כתבה פיננסית מהתקופה מייחסת לו במפורש את תנועת השוק.`,
    specific: ref && `הנייר זז שונה מהותית מ${ref.label} (${signed(ref.changePct)}) — נדרשת סיבה ספציפית לחברה/לענף, מגובה בכתבה מהתקופה.`,
    mixed: ref && `חלק מהתנועה תואם את ${ref.label} (${signed(ref.changePct)}); ציין זאת, וייחס את השאר רק לגורם שמגובה בכתבה.`,
  }[diagnosis?.kind]
  return `\nנתוני שוק מדודים (Yahoo Finance) — עובדות מחייבות, ${period === 'day' ? 'לסשן האחרון של כל נייר' : 'לאותה תקופה בדיוק'}:
${lines.join('\n')}${hint ? `\nאבחנה כמותית: ${hint}` : ''}`
}

/** Facts-only Hebrew text, published when no news driver survives fact-checking but the numbers speak. */
export function factsOnlyText({ subject, isIndex, changePct, diagnosis, periodHe = 'היום' }) {
  const ref = diagnosis?.ref
  if (diagnosis?.kind !== 'market-wide' || !ref || changePct == null) return null
  const masc = isIndex || /^מדד/.test(subject || '')
  const verb = masc ? (changePct >= 0 ? 'עלה' : 'ירד') : (changePct >= 0 ? 'עלתה' : 'ירדה')
  const refVerb = ref.changePct >= 0 ? 'עלייה' : 'ירידה'
  const scope = ref.symbol === 'TA35.TA' ? 'בבורסה בתל אביב כולה' : 'שמגיעה מהשווקים בארה"ב'
  return `${subject} ${verb} ${Math.abs(changePct).toFixed(2)}% ${periodHe}, במקביל ל${refVerb} של ${Math.abs(ref.changePct).toFixed(2)}% ב${ref.label.replace(/^ה/, '')}. לפי הנתונים זו תנועה רוחבית ${scope}, ולא נמצאה בחדשות סיבה ספציפית מאומתת מעבר לכך.`
}
