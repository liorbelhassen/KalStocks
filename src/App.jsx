import { useEffect, useRef, useState } from 'react'
import StockTile from './components/StockTile'
import { searchCatalog, kindLabel } from './catalog'
import { subscribeWatchlist, addToWatchlist, removeFromWatchlist } from './services/watchlist'
import { subscribeSnapshots } from './services/snapshots'

export default function App() {
  const [watchlist, setWatchlist] = useState([])
  const [snapshots, setSnapshots] = useState({})
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    const unsubW = subscribeWatchlist(setWatchlist, (e) => setError(e.message))
    const unsubS = subscribeSnapshots(setSnapshots, (e) => setError(e.message))
    return () => {
      unsubW()
      unsubS()
    }
  }, [])

  // Close the dropdown on outside click.
  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const owned = watchlist.map((w) => w.symbol)
  const results = open ? searchCatalog(q, { excludeSymbols: owned }) : []
  const rawTicker = q.trim().toUpperCase()
  const canAddRaw =
    q.trim().length > 0 && !results.some((r) => r.symbol === rawTicker) && !owned.includes(rawTicker)

  const add = async (item) => {
    try {
      await addToWatchlist(item)
      setQ('')
      setOpen(false)
    } catch (err) {
      setError(err.message)
    }
  }

  const stocks = watchlist.map((w) => {
    const priceSym = w.priceSymbol || w.symbol
    const snap = snapshots[priceSym]
    return {
      key: w.symbol,
      symbol: w.symbol,
      nameHe: w.nameHe,
      note: w.kind === 'etf' ? 'מתומחר לפי מדד ת"א 35' : null,
      isIndex: snap?.isIndex,
      priceIls: snap?.priceIls,
      changePct: snap?.changePct,
      spark: (snap?.series || []).map((p) => p.v),
      explanation: null, // Phase 4
    }
  })

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 60px' }}>
      <header style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>KalStocks</h1>
          <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>הסבר עממי לתנודות בורסת תל אביב</span>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 6 }}>
          נתונים לצורכי מידע בלבד — אינם מהווים ייעוץ השקעות · המחירים מתעדכנים באיחור של כ־15 דקות.
        </p>
      </header>

      {error && (
        <div
          style={{
            background: 'var(--down-bg)', color: 'var(--down)', border: '1px solid var(--down)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13,
          }}
        >
          שגיאת חיבור ל־Firestore: {error}
        </div>
      )}

      {/* Autocomplete search */}
      <div ref={boxRef} style={{ position: 'relative', marginBottom: 24, maxWidth: 520 }}>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder='חפש מניה, קרן סל או מדד (למשל: 35, בנק, טבע)'
          style={{
            width: '100%', background: 'var(--panel)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '11px 14px', color: 'var(--text)', fontSize: 15,
          }}
        />
        {open && (results.length > 0 || canAddRaw) && (
          <div
            style={{
              position: 'absolute', top: '100%', insetInlineStart: 0, insetInlineEnd: 0, marginTop: 6,
              background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10,
              overflow: 'hidden', zIndex: 20, boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
            }}
          >
            {results.map((item) => (
              <button
                key={item.symbol}
                onClick={() => add(item)}
                style={{
                  display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                  gap: 10, padding: '10px 14px', background: 'transparent', border: 'none',
                  borderBottom: '1px solid var(--border)', color: 'var(--text)', textAlign: 'start',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>{item.nameHe}</span>
                  <span style={{
                    fontSize: 11, color: 'var(--text-dim)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '1px 6px',
                  }}>{kindLabel(item.kind)}</span>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', direction: 'ltr' }}>
                  {item.kind === 'etf' ? 'ת"א 35' : item.symbol}
                </span>
              </button>
            ))}
            {canAddRaw && (
              <button
                onClick={() => add({ symbol: rawTicker, nameHe: rawTicker, priceSymbol: rawTicker, kind: 'equity' })}
                style={{
                  display: 'block', width: '100%', padding: '10px 14px', background: 'transparent',
                  border: 'none', color: 'var(--accent)', textAlign: 'start', fontSize: 13.5,
                }}
              >
                + הוסף סימבול Yahoo: <span style={{ direction: 'ltr' }}>{rawTicker}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {stocks.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>
          עדיין אין מניות במעקב. חפש למעלה כדי להוסיף.
        </div>
      ) : (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {stocks.map((s) => (
            <StockTile key={s.key} stock={s} onRemove={() => removeFromWatchlist(s.symbol)} />
          ))}
        </section>
      )}
    </div>
  )
}
