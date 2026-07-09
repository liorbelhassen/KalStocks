import { useState } from 'react'
import PriceChart from './PriceChart'
import { MiniField, tileView, fmt0, fmtTs } from './tileBits'

const TABS = [['today', 'היום'], ['week', 'השבוע'], ['month', 'החודש']]

// A unified card for instruments that track the same underlying (e.g. the TA-35 index + its ETFs).
// The review + chart + % are shared and shown once; each member gets a compact row with its own
// holding value and controls. `rep` is the representative member for the shared data.
export default function FamilyCard({ title, rep, members, insightFontSize = 14, onRemove, onQuantity, onPrice }) {
  const [tab, setTab] = useState('today')
  const view = tileView(rep, tab)
  const cur = rep.currency || '₪'
  const hasChange = view.pct != null
  const up = (view.pct ?? 0) >= 0
  const color = up ? 'var(--up)' : 'var(--down)'
  const bg = up ? 'var(--up-bg)' : 'var(--down-bg)'

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
      {/* header: title + shared % + tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 800 }}>{title}</span>
        {hasChange && (
          <span style={{ padding: '4px 14px', borderRadius: 14, background: bg, color, fontSize: 40, fontWeight: 800, lineHeight: 1.1, direction: 'ltr' }}>
            {up ? '▲' : '▼'} {Math.abs(view.pct).toFixed(2)}%
          </span>
        )}
        <div style={{ display: 'inline-flex', gap: 3, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 9, padding: 3, marginRight: 'auto' }}>
          {TABS.map(([t, lbl]) => (
            <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? 'var(--accent)' : 'transparent', color: tab === t ? '#fff' : 'var(--text-dim)', border: 'none', borderRadius: 7, padding: '4px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* shared chart */}
      <PriceChart series={view.series} period={tab} color={color} currency={cur} isIndex={rep.isIndex} height={150} />

      {/* shared review — once */}
      {view.insight && (
        <div style={{ marginTop: 8 }}>
          {(view.insight.label || view.ts) && (
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)' }}>
              {view.insight.label}{view.ts ? `${view.insight.label ? ' · ' : ''}🕐 ${fmtTs(view.ts)}` : ''}
            </div>
          )}
          <div style={{ fontSize: insightFontSize, lineHeight: 1.5 }}>{view.insight.text}</div>
          {view.insight.confidence && (
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 1 }}>
              ביטחון: {view.insight.confidence}
              {view.insight.sources.length > 0 && ` · ${view.insight.sources.slice(0, 2).join(', ')}`}
            </div>
          )}
        </div>
      )}

      {/* member rows — index + each ETF, compact */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 6, display: 'flex', flexDirection: 'column' }}>
        {members.map((m) => {
          const qty = Number(m.quantity) || 0
          const value = m.priceIls != null && qty > 0 ? qty * m.priceIls : null
          return (
            <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <span style={{ minWidth: 150, fontSize: 15, fontWeight: 600 }}>{m.nameHe}</span>
              <span style={{ flex: 1 }} />
              {value != null && <span style={{ fontSize: 14, fontWeight: 800, direction: 'ltr' }}>{cur}{fmt0(value)}</span>}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {m.needsPrice && <MiniField key={'p' + (m.manualPrice ?? 'n')} label={`מחיר ${cur}`} value={m.manualPrice} onCommit={(p) => onPrice(m.symbol, p)} width={50} />}
                <MiniField key={'q' + (m.quantity ?? 'n')} label="כמות" value={m.quantity} onCommit={(q) => onQuantity(m.symbol, q)} width={44} />
              </div>
              <button onClick={() => onRemove(m.symbol)} title="הסר מהמעקב" style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 15, lineHeight: 1, padding: 2 }}>✕</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
