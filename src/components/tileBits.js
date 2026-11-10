import { isPeriodCurrent } from '../../lib/periods.js'
import { periodFactsText } from '../../lib/factsText.js'
import { META_RE, LEGACY_TEXT_RE } from '../../lib/validate.js'
import { measuredAnalysis } from '../../lib/analysis.js'
import { diagnoseMove } from '../../lib/market.js'

export const fmt = (n) => n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmt0 = (n) => n.toLocaleString('he-IL', { maximumFractionDigits: 0 })

const dmy = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '')
const rangeLabel = (p) => (p?.startDate && p?.endDate ? ` · ${dmy(p.startDate)}–${dmy(p.endDate)}` : '')

/**
 * The text block for a week/month tab. Every state gets an explicit message — never a silent blank:
 * manual-price (no history), loading, fetch error, out-of-date window, fact-checked AI analysis, or a
 * data-only summary that is labelled as data (not presented as an AI insight).
 */
export function periodInsight(p, period, { now = Date.now(), manualOnly = false, isIndex = false, symbol = '' } = {}) {
  const name = period === 'week' ? 'השבוע' : 'החודש'
  const label = period === 'week' ? '📅 השבוע' : '🗓️ החודש'
  const msg = (text, kind = 'status') => ({ text, confidence: null, sources: [], label, kind })
  if (manualOnly) return msg(`לנייר עם מחיר ידני אין היסטוריית מחירים, ולכן אין נתוני ${name}.`)
  if (!p) return msg(`טוען נתוני ${name}…`, 'pending')
  if (p.changePct == null) {
    return p.error
      ? msg(`לא התקבלו נתוני מחיר ל${name} (ייתכן שהנייר לא נסחר בתקופה או שהסימול אינו מוכר ב-Yahoo). ננסה שוב בעדכון הבא.`, 'error')
      : msg(`נתוני ${name} עדיין לא חושבו — הם יופיעו אחרי העדכון הבא.`, 'pending')
  }
  if (!isPeriodCurrent(p, now)) return msg('הנתונים לתקופה זו עדיין לא עודכנו — הם יופיעו אחרי העדכון הבא.', 'pending')
  if (p.explanation && p.verdict && !META_RE.test(p.explanation) && !LEGACY_TEXT_RE.test(p.explanation)) return { text: p.explanation, confidence: p.confidence, sources: p.sources || [], label: label + rangeLabel(p), kind: 'insight' }
  return { text: periodDataText(p, period, isIndex, symbol), confidence: null, sources: [], label: `📊 נתוני ${name}${rangeLabel(p)} (ללא ניתוח AI)`, kind: 'data' }
}

// Measured-data text for a period: the plain-language analysis from the numbers (vs. the benchmark
// when one was measured over the same window), else the bare facts line.
function periodDataText(p, period, isIndex, symbol) {
  const b = p.benchmark
  if (!(b?.symbol && b.changePct != null)) return periodFactsText(p, period, { isIndex })
  const diagnosis = diagnoseMove({ symbol: symbol || '', isIndex, changePct: p.changePct, facts: [b] })
  return measuredAnalysis({ subject: isIndex ? 'המדד' : 'הנייר', isIndex, market: p.market, changePct: p.changePct, period, facts: [b], diagnosis }) || periodFactsText(p, period, { isIndex })
}

export function todayLabel(explanation) {
  if (!explanation) return ''
  if (explanation.kind === 'event') return '📊 הסבר לתנודה'
  if (explanation.kind === 'brief') return explanation.session === 'midday' ? '🕐 עדכון צהריים' : '☀️ סקירת בוקר'
  if (explanation.kind === 'data') return '📈 נתוני המסחר היום (ללא ניתוח AI)'
  return ''
}

// "when was this insight generated" — a short date+time stamp for the insight header.
export function fmtTs(ms) {
  if (!ms) return ''
  return new Date(ms).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Resolve the active period's { pct, series, insight, ts } for a stock and the selected tab.
export function tileView(stock, tab, now = Date.now()) {
  if (tab === 'week' || tab === 'month') {
    const p = stock.periods?.[tab]
    const opts = { now, manualOnly: !!stock.manualOnly, isIndex: !!stock.isIndex, symbol: stock.priceSymbol || stock.symbol || '' }
    // An out-of-date window (e.g. last updated weeks ago) must not be presented as "this week/month".
    if (stock.manualOnly || p?.changePct == null || !isPeriodCurrent(p, now)) return { pct: null, series: [], insight: periodInsight(p, tab, opts), ts: null }
    return { pct: p.changePct, series: p.series || [], insight: periodInsight(p, tab, opts), ts: p.live ? null : p.at || stock.periods?.updatedAt || null }
  }
  const todayInsight = stock.explanation ? { ...stock.explanation, label: todayLabel(stock.explanation) } : null
  return { pct: stock.changePct, series: stock.series || [], insight: todayInsight, ts: stock.explanation?.ts }
}
