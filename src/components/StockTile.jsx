import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'

const fmt = (n) =>
  n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const tFmt = (t) => new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

function Badge({ badge }) {
  if (!badge) return null
  if (badge.type === 'flag') return <span style={{ fontSize: 20, flexShrink: 0 }}>{badge.char}</span>
  return (
    <span
      style={{
        width: 22, height: 22, borderRadius: 5, background: badge.color, color: '#fff',
        fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0,
      }}
    >
      {badge.char}
    </span>
  )
}

export default function StockTile({ stock, onRemove }) {
  const hasData = stock.priceIls != null
  const up = (stock.changePct ?? 0) >= 0
  const color = up ? 'var(--up)' : 'var(--down)'
  const bg = up ? 'var(--up-bg)' : 'var(--down-bg)'
  const series = stock.series || []
  const sparkData = series.map((p, i) => ({ i, v: p.v }))
  const timeRange = series.length > 1 ? `היום · ${tFmt(series[0].t)}–${tFmt(series[series.length - 1].t)}` : null

  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
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
              {hasData ? (stock.isIndex ? fmt(stock.priceIls) : `₪${fmt(stock.priceIls)}`) : '—'}
            </div>
            {hasData && (
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

      {hasData ? (
        <div>
          <div style={{ height: 44 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <YAxis domain={['dataMin', 'dataMax']} hide />
                <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
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
          <div>{stock.explanation.text}</div>
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
            <span>·</span>
            <span>מקורות: {stock.explanation.sources.join(', ')}</span>
            <span>·</span>
            <span>{stock.explanation.at}</span>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', fontStyle: 'italic' }}>
          אין תנודה חריגה שדורשת הסבר כרגע.
        </div>
      )}

      {stock.thresholdPct != null && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', direction: 'rtl' }}>
          סף התראה: {stock.thresholdPct}%
        </div>
      )}
    </div>
  )
}
