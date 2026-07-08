import { useEffect, useRef, useState } from 'react'
import StockTile from './components/StockTile'
import Settings from './components/Settings'
import { searchCatalog, matchInstrument, kindLabel } from './catalog'
import { logoUrl, isFlag } from '../lib/logos'
import { subscribeWatchlist, addToWatchlist, removeFromWatchlist, updateThreshold, updateQuantity } from './services/watchlist'
import { analyzeScreenshot } from './services/vision'
import { subscribeSnapshots } from './services/snapshots'
import { subscribeExplanations } from './services/explanations'
import { subscribeBriefs } from './services/briefs'

export default function App() {
  const [watchlist, setWatchlist] = useState([])
  const [snapshots, setSnapshots] = useState({})
  const [explanations, setExplanations] = useState({})
  const [briefs, setBriefs] = useState({})
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)
  const boxRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    const unsubW = subscribeWatchlist(setWatchlist, (e) => setError(e.message))
    const unsubS = subscribeSnapshots(setSnapshots, (e) => setError(e.message))
    const unsubE = subscribeExplanations(setExplanations, (e) => setError(e.message))
    const unsubB = subscribeBriefs(setBriefs, (e) => setError(e.message))
    return () => {
      unsubW()
      unsubS()
      unsubE()
      unsubB()
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

  const onUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setImportMsg('מנתח את צילום המסך…')
    try {
      const holdings = await analyzeScreenshot(file)
      let added = 0
      const unmatched = []
      for (const h of holdings) {
        const match = matchInstrument(h.name)
        if (match) {
          await addToWatchlist({ ...match, quantity: h.quantity ?? undefined })
          added++
        } else {
          unmatched.push(h.name)
        }
      }
      setImportMsg(
        `זוהו ${holdings.length} · נוספו/עודכנו ${added}` + (unmatched.length ? ` · לא זוהו בקטלוג: ${unmatched.join(', ')}` : ''),
      )
    } catch (err) {
      setImportMsg('⚠️ ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const stocks = watchlist.map((w) => {
    const priceSym = w.priceSymbol || w.symbol
    const snap = snapshots[priceSym]
    const exp = explanations[w.symbol]
    const brief = briefs[priceSym]
    const hhmm = (ms) => (ms ? new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '')
    // Priority: significant-event AI explanation → morning AI brief → a data-derived baseline
    // (so every instrument — indices included — always shows an insight, upgraded to AI when available).
    const dataInsight = () => {
      const c = snap?.changePct
      if (c == null) return null
      const noun = snap.isIndex ? 'המדד' : 'המניה'
      const desc = Math.abs(c) < 0.3 ? 'נסחר סביב רמת הפתיחה, ללא שינוי מהותי היום' : `${c >= 0 ? 'עלה' : 'ירד'} ${Math.abs(c).toFixed(1)}% היום, במגמה ${c >= 0 ? 'חיובית' : 'שלילית'}`
      return { text: `${noun} ${desc}.`, confidence: null, sources: [], at: '', kind: 'data' }
    }
    const insight = exp
      ? { text: exp.explanation, confidence: exp.confidence, sources: exp.sources || [], at: hhmm(exp.at), kind: 'event' }
      : brief
        ? { text: brief.assessment, confidence: brief.confidence, sources: brief.sources || [], at: hhmm(brief.at), kind: 'brief', session: brief.session }
        : dataInsight()
    return {
      key: w.symbol,
      symbol: w.symbol,
      nameHe: w.nameHe,
      badge: isFlag(w.symbol, { kind: w.kind, isIndex: snap?.isIndex })
        ? { flag: true }
        : { logo: logoUrl(w.symbol) },
      note: w.kind === 'etf' ? 'מתומחר לפי מדד ת"א 35' : null,
      thresholdPct: w.thresholdPct,
      quantity: w.quantity,
      isIndex: snap?.isIndex,
      priceIls: snap?.priceIls,
      changePct: snap?.changePct,
      series: snap?.series || [],
      explanation: insight,
    }
  })

  const lastUpdatedMs = Math.max(0, ...Object.values(snapshots).map((s) => s.updatedAt || 0))
  const lastUpdatedLabel = lastUpdatedMs
    ? new Date(lastUpdatedMs).toLocaleString('he-IL', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : '—'

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 60px' }}>
      <header style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>KalStocks</h1>
            <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>הסבר עממי לתנודות בורסת תל אביב</span>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            title="הגדרות ספי התראה"
            style={{
              background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10,
              padding: '8px 14px', color: 'var(--text)', fontSize: 14, whiteSpace: 'nowrap',
            }}
          >
            ⚙️ הגדרות
          </button>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 6 }}>
          נתונים לצורכי מידע בלבד — אינם מהווים ייעוץ השקעות · המחירים מתעדכנים באיחור של כ־15 דקות.
        </p>
      </header>

      {settingsOpen && (
        <Settings
          watchlist={watchlist}
          onClose={() => setSettingsOpen(false)}
          onUpdate={(symbol, thr) => updateThreshold(symbol, thr).catch((e) => setError(e.message))}
        />
      )}

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} style={{ display: 'none' }} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          style={{
            background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 10,
            padding: '9px 14px', color: 'var(--text)', fontSize: 13.5, opacity: importing ? 0.6 : 1,
          }}
        >
          📷 העלה צילום מסך של התיק
        </button>
        {importMsg && <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{importMsg}</span>}
      </div>

      {stocks.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>
          עדיין אין מניות במעקב. חפש למעלה או העלה צילום מסך כדי להתחיל.
        </div>
      ) : (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {stocks.map((s) => (
            <StockTile
              key={s.key}
              stock={s}
              onRemove={() => removeFromWatchlist(s.symbol)}
              onQuantity={(q) => updateQuantity(s.symbol, q).catch((e) => setError(e.message))}
            />
          ))}
        </section>
      )}

      <footer style={{ marginTop: 28, textAlign: 'start', color: 'var(--text-dim)', fontSize: 11.5 }}>
        עודכן לאחרונה: {lastUpdatedLabel} · המחירים מתרעננים אוטומטית כל ~5 דקות בשעות המסחר.
      </footer>
    </div>
  )
}
