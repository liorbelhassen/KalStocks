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
export async function fetchMarketFacts({ symbol, market, period = 'day', window = null, now = Date.now(), extra = [], fetchSnapshot = yahooSnapshot } = {}) {
  const more = extra.filter((e) => e?.symbol && e.symbol !== symbol)
  const syms = [...more.map((e) => e.symbol), ...benchmarksFor(symbol, { market, period })]
  const opts = period === 'day' || !window ? { range: '1d' } : { interval: '1d', period1: (window.baseStart ?? window.start) / 1000, period2: window.end / 1000 }
  const settled = await Promise.allSettled(syms.map((s) => fetchSnapshot(s, opts)))
  const out = []
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') return
    const snap = r.value
    if (snap?.changePct == null || !Number.isFinite(snap.changePct)) return
    if (period === 'day' && snap.at && now - snap.at > MAX_DAY_AGE_MS) return
    const e = more.find((x) => x.symbol === syms[i])
    out.push({ symbol: syms[i], label: e?.label || BENCHMARK_LABELS[syms[i]] || syms[i], changePct: Math.round(snap.changePct * 100) / 100, asOf: snap.at || null, ...(e ? { role: e.role, group: e.group } : {}) })
  })
  return out
}

const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

const follows = (c, r) => Math.sign(r) === Math.sign(c) && Math.abs(r) >= 0.25 && Math.abs(r) >= 0.4 * Math.abs(c)

/**
 * Deterministic read of the numbers: does the instrument move with its sector (sector-wide), with
 * its market (market-wide), against or far beyond it (instrument-specific), or is the move too
 * small to explain? `market` = the broad-market reference even when the sector is the ref.
 * Returns { kind: 'flat'|'sector-wide'|'market-wide'|'specific'|'mixed'|'unknown', ref, market }.
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
  if (Math.abs(changePct) < 0.3) return { kind: 'flat', ref, market: ref }
  const sector = isIndex ? null : facts.find((f) => f.role === 'sector')
  if (sector && follows(changePct, sector.changePct)) return { kind: 'sector-wide', ref: sector, market: ref }
  if (!ref) return { kind: 'unknown', ref: null, market: null }
  const same = Math.sign(ref.changePct) === Math.sign(changePct)
  if (follows(changePct, ref.changePct)) return { kind: 'market-wide', ref, market: ref }
  if (!same || Math.abs(changePct - ref.changePct) >= Math.max(1, Math.abs(changePct) * 0.6)) return { kind: 'specific', ref, market: ref }
  return { kind: 'mixed', ref, market: ref }
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
    'sector-wide': ref && `הנייר נע יחד עם הענף שלו — ${ref.label} (${signed(ref.changePct)}) — כלומר זו תנועה של הענף כולו. ההסבר חייב לומר זאת, ולהסביר מה הזיז את הענף לפי כתבה מהתקופה.`,
    'market-wide': ref && `התנועה תואמת את ${ref.label} (${signed(ref.changePct)}) — זו תנועה רוחבית של השוק, וזה חייב להיות הגורם המרכזי בהסבר. אסור לייחס אותה לאירוע אחר אלא אם כתבה פיננסית מהתקופה מייחסת לו במפורש את תנועת השוק.`,
    specific: ref && `הנייר זז שונה מהותית מ${ref.label} (${signed(ref.changePct)}) — נדרשת סיבה ספציפית לחברה/לענף (דיווח, אירוע חריג אצל החברה או אצל מתחריה, החלטה רגולטורית), מגובה בכתבה מהתקופה. אל תסתפק באמירה שהנייר נע שונה מהשוק.`,
    mixed: ref && `חלק מהתנועה תואם את ${ref.label} (${signed(ref.changePct)}); ציין זאת, וייחס את השאר רק לגורם שמגובה בכתבה.`,
  }[diagnosis?.kind]
  return `\nנתוני שוק מדודים (Yahoo Finance) — עובדות מחייבות, ${period === 'day' ? 'לסשן האחרון של כל נייר' : 'לאותה תקופה בדיוק'}:
${lines.join('\n')}${hint ? `\nאבחנה כמותית: ${hint}` : ''}`
}
