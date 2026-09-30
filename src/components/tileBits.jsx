import { useState } from 'react'
import { isPeriodCurrent } from '../../lib/periods'
import { META_RE, LEGACY_TEXT_RE } from '../../lib/validate'
import { measuredAnalysis } from '../../lib/analysis'
import { sourceLinks } from '../../lib/sources'

export const fmt = (n) => n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmt0 = (n) => n.toLocaleString('he-IL', { maximumFractionDigits: 0 })

// Compact labeled field (pill: label + borderless input). Keyed by value in the parent.
export function MiniField({ label, value, onCommit, width = 46 }) {
  const [v, setV] = useState(value ?? '')
  const commit = () => {
    if (onCommit && String(v) !== String(value ?? '')) onCommit(v === '' ? 0 : v)
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '2px 7px', fontSize: 11, color: 'var(--text-dim)' }}>
      {label}
      <input
        type="number" min="0" step="any" value={v} placeholder="0"
        onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
        style={{ width, background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 12.5, fontWeight: 600, direction: 'ltr', textAlign: 'center', outline: 'none', padding: 0 }}
      />
    </span>
  )
}

// Explanation object for a period tab (with a header label). Falls back to a factual line.
export function periodInsight(p, period, now = Date.now()) {
  if (!p) return null
  const label = period === 'week' ? '📅 השבוע' : '🗓️ החודש'
  if (!isPeriodCurrent(p, now)) return { text: 'הנתונים לתקופה זו עדיין לא עודכנו — הם יופיעו אחרי העדכון הבא.', confidence: null, sources: [], label }
  if (p.explanation && p.verdict && !META_RE.test(p.explanation) && !LEGACY_TEXT_RE.test(p.explanation)) return { text: p.explanation, confidence: p.confidence, sources: p.sources || [], label }
  const text = measuredAnalysis({ subject: 'הנייר', market: p.market, changePct: p.changePct ?? 0, period })
  return { text, confidence: null, sources: [], label }
}

export function todayLabel(explanation) {
  if (!explanation) return ''
  if (explanation.kind === 'event') return '📊 הסבר לתנודה'
  if (explanation.kind === 'brief') return explanation.session === 'midday' ? '🕐 עדכון צהריים' : '☀️ סקירת בוקר'
  if (explanation.kind === 'data') return '📈 מצב נוכחי'
  return ''
}

// "when was this insight generated" — a short date+time stamp for the insight header.
export function fmtTs(ms) {
  if (!ms) return ''
  return new Date(ms).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Resolve the active period's { pct, series, insight, ts } for a stock and the selected tab.
export function tileView(stock, tab) {
  const wk = stock.periods?.week
  const mo = stock.periods?.month
  const periodsTs = stock.periods?.updatedAt
  if (tab === 'week' || tab === 'month') {
    const p = tab === 'week' ? wk : mo
    // An out-of-date window (e.g. last updated weeks ago) must not be presented as "this week/month".
    if (!isPeriodCurrent(p)) return { pct: null, series: [], insight: periodInsight(p, tab), ts: null }
    return { pct: p.changePct, series: p.series || [], insight: periodInsight(p, tab), ts: periodsTs }
  }
  const todayInsight = stock.explanation ? { ...stock.explanation, label: todayLabel(stock.explanation) } : null
  return { pct: stock.changePct, series: stock.series || [], insight: todayInsight, ts: stock.explanation?.ts }
}

export function SourceLinks({ sources, symbol }) {
  return sourceLinks(sources, symbol).slice(0, 2).map((s, i) => (
    <span key={s.name}>
      {i ? ', ' : ''}
      {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{s.name}</a> : s.name}
    </span>
  ))
}
