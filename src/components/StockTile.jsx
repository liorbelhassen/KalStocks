import { useState } from 'react'
import PriceChart from './PriceChart'
import { MiniField, tileView, fmt, fmt0 } from './tileBits'

function Badge({ badge }) {
  if (!badge) return null
  if (badge.flag) return <span style={{ fontSize: 56, flexShrink: 0, lineHeight: 1 }}>🇮🇱</span>
  if (badge.logo) return <img src={badge.logo} alt="" width={68} height={68} style={{ borderRadius: 10, background: '#fff', objectFit: 'contain', flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
  return null
}

const TABS = [['today', 'היום'], ['week', 'השבוע'], ['month', 'החודש']]

export default function StockTile({ stock, onRemove, onQuantity, onPrice, insightFontSize = 13 }) {
  const [tab, setTab] = useState('today')
  const cur = stock.currency || '₪'
  const hasPrice = stock.priceIls != null
  const view = tileView(stock, tab)
  // Shrink long names so they fit (and let them wrap to a 2nd line instead of being clipped).
  const nameLen = (stock.nameHe || '').length
  const nameSize = nameLen > 20 ? 20 : nameLen > 15 ? 25 : nameLen > 10 ? 31 : 38

  const hasChange = view.pct != null
  const up = (view.pct ?? 0) >= 0
  const color = up ? 'var(--up)' : 'var(--down)'
  const bg = up ? 'var(--up-bg)' : 'var(--down-bg)'
  const qty = Number(stock.quantity) || 0
  const value = hasPrice && qty > 0 ? qty * stock.priceIls : null

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
      {/* 1 · identity (FIXED — not affected by the period tab) */}
      <div style={{ width: 300, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <Badge badge={stock.badge} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: nameSize, fontWeight: 700, lineHeight: 1.12, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{stock.nameHe}</div>
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

      {/* 3 · period graph (price area + volume bars + time axis) */}
      <div style={{ width: 300, flexShrink: 0 }}>
        <PriceChart series={view.series} period={tab} color={color} currency={cur} isIndex={stock.isIndex} height={112} />
      </div>

      {/* 4 · sub-tabs + period insight (flexible) */}
      <div style={{ flex: 1, minWidth: 240 }}>
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
            מפיק תובנה…
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
