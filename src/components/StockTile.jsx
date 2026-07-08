import { useState } from 'react'
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts'

const fmt = (n) => n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt0 = (n) => n.toLocaleString('he-IL', { maximumFractionDigits: 0 })

// Compact labeled field (a neat pill: label + borderless input). Keyed by value in the parent.
function MiniField({ label, value, onCommit, width = 46 }) {
  const [v, setV] = useState(value ?? '')
  const commit = () => {
    if (onCommit && String(v) !== String(value ?? '')) onCommit(v === '' ? 0 : v)
  }
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg)',
        border: '1px solid var(--border)', borderRadius: 8, padding: '2px 7px', fontSize: 11, color: 'var(--text-dim)',
      }}
    >
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
  if (badge.flag) return <span style={{ fontSize: 20, flexShrink: 0 }}>🇮🇱</span>
  if (badge.logo) {
    return (
      <img
        src={badge.logo} alt="" width={26} height={26}
        style={{ borderRadius: 5, background: '#fff', objectFit: 'contain', flexShrink: 0 }}
        onError={(e) => { e.currentTarget.style.display = 'none' }}
      />
    )
  }
  return null
}

export default function StockTile({ stock, onRemove, onQuantity, onPrice }) {
  const hasPrice = stock.priceIls != null
  const hasChange = stock.changePct != null
  const up = (stock.changePct ?? 0) >= 0
  const color = up ? 'var(--up)' : 'var(--down)'
  const bg = up ? 'var(--up-bg)' : 'var(--down-bg)'
  const series = stock.series || []
  const sparkData = series.map((p, i) => ({ i, v: p.v }))
  const gid = 'grad-' + (stock.symbol || '').replace(/[^a-zA-Z0-9]/g, '')

  const qty = Number(stock.quantity) || 0
  const value = hasPrice && qty > 0 ? qty * stock.priceIls : null

  const kind = stock.explanation?.kind
  const label =
    kind === 'event' ? '📊 הסבר לתנודה'
      : kind === 'brief' ? (stock.explanation.session === 'midday' ? '🕐 עדכון צהריים' : '☀️ סקירת בוקר')
        : kind === 'data' ? '📈 מצב נוכחי' : ''

  return (
    <div
      style={{
        background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10,
        padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      }}
    >
      {/* 1 · identity */}
      <div style={{ width: 148, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Badge badge={stock.badge} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stock.nameHe}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', direction: 'ltr', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {stock.subtitle}
          </div>
        </div>
      </div>

      {/* 2 · price + change */}
      <div style={{ width: 96, flexShrink: 0, textAlign: 'left', direction: 'ltr' }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>
          {hasPrice ? (stock.isIndex ? fmt(stock.priceIls) : `₪${fmt(stock.priceIls)}`) : '—'}
        </div>
        {hasChange && (
          <span style={{ display: 'inline-block', marginTop: 2, padding: '1px 6px', borderRadius: 999, background: bg, color, fontSize: 12, fontWeight: 700 }}>
            {up ? '▲' : '▼'} {Math.abs(stock.changePct).toFixed(2)}%
          </span>
        )}
      </div>

      {/* 3 · sparkline */}
      <div style={{ width: 92, height: 38, flexShrink: 0 }}>
        {series.length ? (
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

      {/* 4 · insight (flexible) */}
      <div style={{ flex: 1, minWidth: 190 }}>
        {stock.explanation ? (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)' }}>{label}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {stock.explanation.text}
            </div>
            {stock.explanation.confidence && (
              <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 1 }}>
                ביטחון: {stock.explanation.confidence}
                {stock.explanation.sources.length > 0 && ` · ${stock.explanation.sources.slice(0, 2).join(', ')}`}
              </div>
            )}
          </>
        ) : (
          <span style={{ fontSize: 12.5, color: 'var(--text-dim)', fontStyle: 'italic' }}>ממתין לנתונים…</span>
        )}
      </div>

      {/* 5 · holdings — value prominent, compact inputs, no clutter */}
      <div style={{ width: 132, flexShrink: 0, direction: 'ltr', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        {value != null && <div style={{ fontSize: 15, fontWeight: 800 }}>₪{fmt0(value)}</div>}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {stock.needsPrice && <MiniField key={'p' + (stock.manualPrice ?? 'n')} label="מחיר ₪" value={stock.manualPrice} onCommit={onPrice} width={50} />}
          <MiniField key={'q' + (stock.quantity ?? 'n')} label="כמות" value={stock.quantity} onCommit={onQuantity} width={44} />
        </div>
      </div>

      {/* 6 · remove */}
      <button
        onClick={() => onRemove(stock.symbol)} title="הסר מהמעקב"
        style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 15, lineHeight: 1, flexShrink: 0, padding: 2 }}
      >
        ✕
      </button>
    </div>
  )
}
