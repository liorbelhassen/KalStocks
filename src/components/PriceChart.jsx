import { ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

// A professional price chart: price area (right axis) + volume bars (hidden left axis), with a
// time X-axis, gridlines and a hover tooltip. Reused by the stock tiles and the TA-35 card.
// series: [{ t: ms, v: price, vol?: number }]. period: 'today' | 'week' | 'month'.
const fmtPrice = (n) => (n == null ? '' : n >= 1000 ? Math.round(n).toLocaleString('he-IL') : n.toFixed(2))
const fmtVol = (n) =>
  n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`

function tickTime(period) {
  return (t) => {
    const d = new Date(t)
    if (period === 'today') return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    if (period === 'week') return d.toLocaleDateString('he-IL', { weekday: 'short' })
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
  }
}
function fullTime(t, period) {
  const d = new Date(t)
  return period === 'today'
    ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function ChartTip({ active, payload, period, currency, isIndex }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0].payload
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 9px', fontSize: 11.5, direction: 'ltr', textAlign: 'left' }}>
      <div style={{ color: 'var(--text-dim)', marginBottom: 2 }}>{fullTime(p.t, period)}</div>
      <div style={{ fontWeight: 700 }}>{isIndex ? '' : currency}{fmtPrice(p.v)}</div>
      {p.vol ? <div style={{ color: 'var(--text-dim)' }}>מחזור: {fmtVol(p.vol)}</div> : null}
    </div>
  )
}

export default function PriceChart({ series = [], period = 'today', color = 'var(--up)', currency = '₪', isIndex = false, height = 110 }) {
  const data = (series || []).filter((p) => p && p.v != null)
  if (data.length < 2) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 11.5 }}>אין מספיק נתונים לגרף</div>
  }
  const hasVol = data.some((p) => p.vol != null && p.vol > 0)
  const maxVol = Math.max(...data.map((p) => p.vol || 0), 1)
  const gid = `pc-${Math.round(data[0].t)}-${period}`

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 2, left: 4 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="t" tickFormatter={tickTime(period)} tick={{ fontSize: 10, fill: 'var(--text-dim)' }} minTickGap={36} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <YAxis yAxisId="price" orientation="right" domain={['auto', 'auto']} tickFormatter={fmtPrice} tick={{ fontSize: 10, fill: 'var(--text-dim)' }} width={46} axisLine={false} tickLine={false} />
          {hasVol && <YAxis yAxisId="vol" orientation="left" domain={[0, maxVol * 4]} hide />}
          <Tooltip content={<ChartTip period={period} currency={currency} isIndex={isIndex} />} />
          {hasVol && <Bar yAxisId="vol" dataKey="vol" fill="var(--text-dim)" opacity={0.18} isAnimationActive={false} />}
          <Area yAxisId="price" type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
