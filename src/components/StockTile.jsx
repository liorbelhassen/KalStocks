import { useState } from 'react'
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts'

const fmt = (n) => n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt0 = (n) => n.toLocaleString('he-IL', { maximumFractionDigits: 0 })

// Compact labeled field (pill: label + borderless input). Keyed by value in the parent.
function MiniField({ label, value, onCommit, width = 46 }) {
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

function Badge({ badge }) {
  if (!badge) return null
  if (badge.flag) return <span style={{ fontSize: 56, flexShrink: 0, lineHeight: 1 }}>🇮🇱</span>
  if (badge.logo) return <img src={badge.logo} alt="" width={68} height={68} style={{ borderRadius: 10, background: '#fff', objectFit: 'contain', flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
  return null
}

// Build the explanation object for a period tab (with a header label).
function periodInsight(p, period) {
  if (!p) return null
  const label = period === 'week' ? '📅 השבוע' : '🗓️ החודש'
  if (p.explanation) return { text: p.explanation, confidence: p.confidence, sources: p.sources || [], label }
  const dir = (p.changePct ?? 0) >= 0 ? 'עלה' : 'ירד'
  const periodHe = period === 'week' ? 'בשבוע האחרון' : 'בחודש האחרון'
  return { text: `הנייר ${dir} ${Math.abs(p.changePct ?? 0).toFixed(1)}% ${periodHe}.`, confidence: null, sources: [], label }
}

const TABS = [['today', 'היום'], ['week', 'השבוע'], ['month', 'החודש']]

export default function StockTile({ stock, onRemove, onQuantity, onPrice, insightFontSize = 13 }) {
  const [tab, setTab] = useState('today')
  const cur = stock.currency || '₪'
  const hasPrice = stock.priceIls != null

  // Today insight carries its own kind-based label; week/month come from periods.
  const todayLabel =
    stock.explanation?.kind === 'event' ? '📊 הסבר לתנודה'
      : stock.explanation?.kind === 'brief' ? (stock.explanation.session === 'midday' ? '🕐 עדכון צהריים' : '☀️ סקירת בוקר')
        : stock.explanation?.kind === 'data' ? '📈 מצב נוכחי' : ''
  const todayInsight = stock.explanation ? { ...stock.explanation, label: todayLabel } : null

  const wk = stock.periods?.week
  const mo = stock.periods?.month
  const view =
    tab === 'week' ? { pct: wk?.changePct, series: wk?.series || [], insight: periodInsight(wk, 'week') }
      : tab === 'month' ? { pct: mo?.changePct, series: mo?.series || [], insight: periodInsight(mo, 'month') }
        : { pct: stock.changePct, series: stock.series || [], insight: todayInsight }

  const hasChange = view.pct != null
  const up = (view.pct ?? 0) >= 0
  const color = up ? 'var(--up)' : 'var(--down)'
  const bg = up ? 'var(--up-bg)' : 'var(--down-bg)'
  const sparkData = (view.series || []).map((p, i) => ({ i, v: p.v }))
  const gid = `grad-${(stock.symbol || '').replace(/[^a-zA-Z0-9]/g, '')}-${tab}`
  const qty = Number(stock.quantity) || 0
  const value = hasPrice && qty > 0 ? qty * stock.priceIls : null

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
      {/* 1 · identity (FIXED — not affected by the period tab) */}
      <div style={{ width: 300, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <Badge badge={stock.badge} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stock.nameHe}</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', direction: 'ltr', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stock.subtitle}</div>
        </div>
      </div>

      {/* 2 · price (current, fixed) + period change */}
      <div style={{ width: 240, flexShrink: 0, textAlign: 'left', direction: 'ltr' }}>
        <div style={{ fontSize: 21, fontWeight: 800 }}>{hasPrice ? (stock.isIndex ? fmt(stock.priceIls) : `${cur}${fmt(stock.priceIls)}`) : '—'}</div>
        {hasChange && (
          <span style={{ display: 'inline-block', marginTop: 4, padding: '4px 14px', borderRadius: 14, background: bg, color, fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}>
            {up ? '▲' : '▼'} {Math.abs(view.pct).toFixed(2)}%
          </span>
        )}
      </div>

      {/* 3 · period graph */}
      <div style={{ width: 92, height: 44, flexShrink: 0 }}>
        {sparkData.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <YAxis domain={['dataMin', 'dataMax']} hide />
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : null}
      </div>

      {/* 4 · sub-tabs + period insight (flexible) */}
      <div style={{ flex: 1, minWidth: 210 }}>
        <div style={{ display: 'inline-flex', gap: 3, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 9, padding: 3, marginBottom: 7 }}>
          {TABS.map(([t, lbl]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: tab === t ? 'var(--accent)' : 'transparent',
                color: tab === t ? '#fff' : 'var(--text-dim)',
                border: 'none', borderRadius: 7, padding: '4px 14px', fontSize: 12.5,
                fontWeight: 700, cursor: 'pointer', transition: 'background 0.12s',
              }}
            >
              {lbl}
            </button>
          ))}
        </div>
        {view.insight ? (
          <>
            {view.insight.label && <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)' }}>{view.insight.label}</div>}
            <div style={{ fontSize: insightFontSize, lineHeight: 1.5 }}>{view.insight.text}</div>
            {view.insight.confidence && (
              <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 1 }}>
                ביטחון: {view.insight.confidence}
                {view.insight.sources.length > 0 && ` · ${view.insight.sources.slice(0, 2).join(', ')}`}
              </div>
            )}
          </>
        ) : (
          <span style={{ fontSize: 12.5, color: 'var(--text-dim)', fontStyle: 'italic' }}>
            {tab === 'today' ? 'ממתין לנתונים…' : 'תובנת התקופה תתעדכן בסקירת הבוקר.'}
          </span>
        )}
      </div>

      {/* 5 · holdings (FIXED — value uses the current price) */}
      <div style={{ width: 132, flexShrink: 0, direction: 'ltr', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        {value != null && <div style={{ fontSize: 15, fontWeight: 800 }}>{cur}{fmt0(value)}</div>}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {stock.needsPrice && <MiniField key={'p' + (stock.manualPrice ?? 'n')} label={`מחיר ${cur}`} value={stock.manualPrice} onCommit={onPrice} width={50} />}
          <MiniField key={'q' + (stock.quantity ?? 'n')} label="כמות" value={stock.quantity} onCommit={onQuantity} width={44} />
        </div>
      </div>

      {/* 6 · remove */}
      <button onClick={() => onRemove(stock.symbol)} title="הסר מהמעקב" style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 15, lineHeight: 1, flexShrink: 0, padding: 2 }}>✕</button>
    </div>
  )
}
