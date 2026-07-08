import { useState } from 'react'
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts'

const fmt = (n) =>
  n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Keyed by the persisted value in the parent, so it re-initializes when the stored quantity
// changes (e.g. after a screenshot import) — no state-sync effect needed.
function QuantityEditor({ value, price, hasData, onQuantity }) {
  const [v, setV] = useState(value ?? '')
  const commit = () => {
    if (onQuantity && String(v) !== String(value ?? '')) onQuantity(v === '' ? 0 : v)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-dim)', flexWrap: 'wrap' }}>
      <span>כמות:</span>
      <input
        type="number" min="0" step="1" value={v} placeholder="—"
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        style={{ width: 72, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '3px 6px', color: 'var(--text)', fontSize: 12, direction: 'ltr', textAlign: 'center' }}
      />
      {Number(v) > 0 && hasData && <span>· שווי: ₪{fmt(Number(v) * price)}</span>}
    </div>
  )
}

// Manual ETF unit price (₪) — ETFs aren't on the free data source, so the user enters the price.
function PriceEditor({ value, onPrice }) {
  const [v, setV] = useState(value ?? '')
  const commit = () => {
    if (onPrice && String(v) !== String(value ?? '')) onPrice(v === '' ? 0 : v)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-dim)', flexWrap: 'wrap' }}>
      <span>מחיר קרן (₪):</span>
      <input
        type="number" min="0" step="0.01" value={v} placeholder="הזן"
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        style={{ width: 82, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '3px 6px', color: 'var(--text)', fontSize: 12, direction: 'ltr', textAlign: 'center' }}
      />
    </div>
  )
}

const tFmt = (t) => new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

function Badge({ badge }) {
  if (!badge) return null
  if (badge.flag) return <span style={{ fontSize: 20, flexShrink: 0 }}>🇮🇱</span>
  if (badge.logo) {
    return (
      <img
        src={badge.logo}
        alt=""
        width={22}
        height={22}
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
  const timeRange = series.length > 1 ? `היום · ${tFmt(series[0].t)}–${tFmt(series[series.length - 1].t)}` : null
  const gid = 'grad-' + (stock.symbol || '').replace(/[^a-zA-Z0-9]/g, '')

  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 13,
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge badge={stock.badge} />
            <span>{stock.nameHe}</span>
          </div>
          {stock.note ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{stock.note}</div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', direction: 'ltr', textAlign: 'right' }}>
              {stock.symbol}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 18, fontWeight: 700, direction: 'ltr' }}>
              {hasPrice ? (stock.isIndex ? fmt(stock.priceIls) : `₪${fmt(stock.priceIls)}`) : '—'}
            </div>
            {hasChange && (
              <div
                style={{
                  display: 'inline-block',
                  marginTop: 4,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: bg,
                  color,
                  fontSize: 13,
                  fontWeight: 700,
                  direction: 'ltr',
                }}
              >
                {up ? '▲' : '▼'} {Math.abs(stock.changePct).toFixed(2)}%
              </div>
            )}
          </div>
          {onRemove && (
            <button
              onClick={() => onRemove(stock.symbol)}
              title="הסר מהמעקב"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                fontSize: 16,
                lineHeight: 1,
                padding: 2,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {series.length ? (
        <div>
          <div style={{ height: 46 }}>
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
          </div>
          {timeRange && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-dim)', direction: 'ltr', marginTop: 2 }}>
              <span>{series.length > 1 ? tFmt(series[0].t) : ''}</span>
              <span>{timeRange}</span>
              <span>{series.length > 1 ? tFmt(series[series.length - 1].t) : ''}</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ height: 44, display: 'flex', alignItems: 'center', color: 'var(--text-dim)', fontSize: 12.5 }}>
          ממתין לנתונים מהשרת…
        </div>
      )}

      {stock.explanation ? (
        <div
          style={{
            background: 'var(--panel-2)',
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 13.5,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: 'var(--text-dim)' }}>
            {stock.explanation.kind === 'event'
              ? '📊 הסבר לתנודה'
              : stock.explanation.kind === 'brief'
                ? stock.explanation.session === 'midday'
                  ? '🕐 עדכון צהריים'
                  : '☀️ סקירת בוקר'
                : '📈 מצב נוכחי'}
          </div>
          <div style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {stock.explanation.text}
          </div>
          {stock.explanation.confidence && (
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                fontSize: 11.5,
                color: 'var(--text-dim)',
              }}
            >
              <span>ביטחון: {stock.explanation.confidence}</span>
              {stock.explanation.sources.length > 0 && <span>·</span>}
              {stock.explanation.sources.length > 0 && <span>מקורות: {stock.explanation.sources.join(', ')}</span>}
              {stock.explanation.at && <span>·</span>}
              {stock.explanation.at && <span>{stock.explanation.at}</span>}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', fontStyle: 'italic' }}>
          ממתין לנתונים…
        </div>
      )}

      {stock.etf && <PriceEditor key={stock.manualPrice ?? 'none'} value={stock.manualPrice} onPrice={onPrice} />}

      <QuantityEditor key={stock.quantity ?? 'none'} value={stock.quantity} price={stock.priceIls} hasData={hasPrice} onQuantity={onQuantity} />

      {stock.thresholdPct != null && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', direction: 'rtl' }}>
          סף התראה: {stock.thresholdPct}%
        </div>
      )}
    </div>
  )
}
