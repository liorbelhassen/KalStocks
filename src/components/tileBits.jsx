import { useState } from 'react'

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
export function periodInsight(p, period) {
  if (!p) return null
  const label = period === 'week' ? '📅 השבוע' : '🗓️ החודש'
  if (p.explanation) return { text: p.explanation, confidence: p.confidence, sources: p.sources || [], label }
  const dir = (p.changePct ?? 0) >= 0 ? 'עלה' : 'ירד'
  const periodHe = period === 'week' ? 'בשבוע האחרון' : 'בחודש האחרון'
  return { text: `הנייר ${dir} ${Math.abs(p.changePct ?? 0).toFixed(1)}% ${periodHe}.`, confidence: null, sources: [], label }
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
  if (tab === 'week') return { pct: wk?.changePct, series: wk?.series || [], insight: periodInsight(wk, 'week'), ts: periodsTs }
  if (tab === 'month') return { pct: mo?.changePct, series: mo?.series || [], insight: periodInsight(mo, 'month'), ts: periodsTs }
  const todayInsight = stock.explanation ? { ...stock.explanation, label: todayLabel(stock.explanation) } : null
  return { pct: stock.changePct, series: stock.series || [], insight: todayInsight, ts: stock.explanation?.ts }
}
