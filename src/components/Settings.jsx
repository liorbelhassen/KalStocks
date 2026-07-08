import { useState } from 'react'
import { kindLabel } from '../catalog'

const PRESETS = [0.5, 1, 2, 3, 5]

function ThresholdRow({ item, onCommit }) {
  const [val, setVal] = useState(String(item.thresholdPct ?? 3))

  const commit = (v) => {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0 && n !== item.thresholdPct) onCommit(item.symbol, n)
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{item.nameHe}</span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 6, padding: '1px 6px' }}>
          {kindLabel(item.kind)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => { setVal(String(p)); commit(p) }}
            style={{
              background: Number(val) === p ? 'var(--accent)' : 'var(--panel-2)',
              color: Number(val) === p ? '#fff' : 'var(--text-dim)',
              border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px',
              fontSize: 12, direction: 'ltr',
            }}
          >
            {p}%
          </button>
        ))}
        <input
          type="number" step="0.5" min="0.1" value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit(e.target.value)}
          style={{
            width: 68, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '5px 8px', color: 'var(--text)', fontSize: 13, direction: 'ltr', textAlign: 'center',
          }}
        />
      </div>
    </div>
  )
}

export default function Settings({ watchlist, onClose, onUpdate }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14,
          padding: 22, width: '100%', maxWidth: 560,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>הגדרות ספי התראה</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 20 }}>✕</button>
        </div>

        <p style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
          הסף קובע איזו תנועה נחשבת "משמעותית" ומפעילה הסבר. תנודה יומית שחוצה את הסף — או תנודתיות
          תוך־יומית גדולה (מעל פי 2 מהסף) — תיצור הסבר. שים לב: <b>מדדים זזים פחות ממניות</b>, לכן סף
          של 1% למדד דומה בעוצמתו לסף של 3% למניה. אפשר להגדיר לכל נייר בנפרד.
        </p>

        {watchlist.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 14, padding: '20px 0', textAlign: 'center' }}>
            אין ניירות במעקב. הוסף ניירות במסך הראשי ואז חזור לכאן.
          </div>
        ) : (
          <div>
            {watchlist.map((w) => (
              <ThresholdRow key={w.symbol} item={w} onCommit={onUpdate} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
