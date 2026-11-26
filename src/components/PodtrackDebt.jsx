import { useEffect, useState } from 'react'
import { sheetUrl, parseGviz, summarizeDebt } from '../../lib/podtrackDebt'

const fmtIls = (n) => `${n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`

const cell = { padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right' }
const head = { ...cell, color: 'var(--text-dim)', fontWeight: 600, fontSize: 13 }

// Public, login-free view reached only via #/podtrack-debt. Reads the sheet on every page load.
export default function PodtrackDebt() {
  const [state, setState] = useState({ loading: true })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const prevTitle = document.title
    document.title = 'PodTrack — חייבים לליאור'
    return () => { document.title = prevTitle }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(sheetUrl(), { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`הגיליון החזיר שגיאה (${r.status})`); return r.text() })
      .then((body) => { if (!cancelled) setState({ data: summarizeDebt(parseGviz(body)), at: new Date() }) })
      .catch((e) => { if (!cancelled) setState({ error: e.message || 'טעינת הנתונים נכשלה' }) })
    return () => { cancelled = true }
  }, [reloadKey])

  const reload = () => { setState({ loading: true }); setReloadKey((k) => k + 1) }
  const { loading, error, data, at } = state

  return (
    <div dir="rtl" style={{ minHeight: '100vh', padding: '32px 16px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 820 }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800 }}>מצב פיננסי PodTrack — חייבים לליאור</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 14, margin: '0 0 24px' }}>הנתונים נטענים ישירות מגיליון ההוצאות בכל רענון של העמוד.</p>

        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px 24px', marginBottom: 20, textAlign: 'center' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 15, marginBottom: 8 }}>סה״כ חוב לליאור</div>
          {loading && <div style={{ fontSize: 18, color: 'var(--text-dim)' }}>טוען נתונים…</div>}
          {error && (
            <div>
              <div style={{ color: 'var(--down)', fontSize: 15, marginBottom: 12 }}>{error}</div>
              <button onClick={reload} style={{ background: 'var(--accent)', color: '#fff', border: 0, borderRadius: 8, padding: '8px 18px', fontSize: 14 }}>נסה שוב</button>
            </div>
          )}
          {data && <div style={{ fontSize: 44, fontWeight: 800, direction: 'ltr', color: data.total > 0 ? 'var(--down)' : 'var(--up)' }}>{fmtIls(data.total)}</div>}
          {at && <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 10 }}>עודכן: {at.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</div>}
        </div>

        {data?.rows.length > 0 && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 16, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={head}>תאריך</th>
                  <th style={head}>פריט</th>
                  <th style={head}>פירוט</th>
                  <th style={head}>סטטוס</th>
                  <th style={{ ...head, textAlign: 'left' }}>סכום</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...cell, whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>{r.date}</td>
                    <td style={cell}>{r.item}</td>
                    <td style={{ ...cell, color: 'var(--text-dim)' }}>{r.details}</td>
                    <td style={cell}>{r.status}</td>
                    <td style={{ ...cell, textAlign: 'left', direction: 'ltr', whiteSpace: 'nowrap', fontWeight: 600, color: r.amount < 0 ? 'var(--up)' : 'var(--text)' }}>{fmtIls(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ ...cell, borderBottom: 0, fontWeight: 700 }}>סה״כ</td>
                  <td style={{ ...cell, borderBottom: 0, textAlign: 'left', direction: 'ltr', whiteSpace: 'nowrap', fontWeight: 800 }}>{fmtIls(data.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
