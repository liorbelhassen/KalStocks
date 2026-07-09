import { useEffect, useRef, useState } from 'react'
import StockTile from './components/StockTile'
import FamilyCard from './components/FamilyCard'
import Settings from './components/Settings'
import { searchCatalog, matchInstrument, kindLabel, sectorOf, SECTOR_ORDER } from './catalog'
import { logoUrl, isFlag } from '../lib/logos'
import { subscribeWatchlist, addToWatchlist, removeFromWatchlist, updateThreshold, updateQuantity, updatePrice, adoptLegacyWatchlist } from './services/watchlist'
import { analyzeScreenshot, quoteSymbol, searchYahoo, resolveSymbol, primeInstrument } from './services/vision'
import { subscribeAuth, signOutUser } from './services/auth'
import Login from './components/Login'

const fmtIls = (n) => (n ?? 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
import { subscribeSnapshots } from './services/snapshots'
import { subscribeExplanations } from './services/explanations'
import { subscribeBriefs } from './services/briefs'
import { subscribePeriods } from './services/periods'

export default function App() {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [watchlist, setWatchlist] = useState([])
  const [snapshots, setSnapshots] = useState({})
  const [explanations, setExplanations] = useState({})
  const [briefs, setBriefs] = useState({})
  const [periods, setPeriods] = useState({}) // week/month data per priceSymbol (daily)
  const [liveQuotes, setLiveQuotes] = useState({}) // instant Worker quotes until the poller persists them
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [remoteResults, setRemoteResults] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [market, setMarket] = useState('IL') // active tab: 'IL' | 'US'
  const [filter, setFilter] = useState('') // filter the watched list by name/symbol
  const [insightSize, setInsightSize] = useState(() => Number(localStorage.getItem('kal_insightSize')) || 14)
  const changeInsightSize = (n) => { setInsightSize(n); localStorage.setItem('kal_insightSize', String(n)) }
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)
  const boxRef = useRef(null)
  const fileRef = useRef(null)

  // Track the signed-in user (session is restored automatically on reload).
  useEffect(() => subscribeAuth((u) => { setUser(u); setAuthReady(true) }), [])

  // Live data — only while signed in. The watchlist is scoped to the user's uid; market data and
  // AI insights (snapshots/explanations/briefs/periods) are shared across all users by symbol.
  useEffect(() => {
    if (!user) return
    // One-time: adopt the legacy single-user portfolio into the admin's account.
    const adminEmail = import.meta.env.VITE_ADMIN_EMAIL
    if (adminEmail && user.email === adminEmail) adoptLegacyWatchlist(user.uid).catch(() => {})

    const unsubW = subscribeWatchlist(user.uid, setWatchlist, (e) => setError(e.message))
    const unsubS = subscribeSnapshots(setSnapshots, (e) => setError(e.message))
    const unsubE = subscribeExplanations(setExplanations, (e) => setError(e.message))
    const unsubB = subscribeBriefs(setBriefs, (e) => setError(e.message))
    const unsubP = subscribePeriods(setPeriods, (e) => setError(e.message))
    return () => {
      unsubW()
      unsubS()
      unsubE()
      unsubB()
      unsubP()
    }
  }, [user])

  // Close the dropdown on outside click.
  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Live Yahoo search (debounced) — finds any stock beyond the catalog.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!open || q.trim().length < 2) setRemoteResults([])
      else searchYahoo(q).then(setRemoteResults)
    }, 250)
    return () => clearTimeout(t)
  }, [q, open])

  // Auth gate — nothing below renders until we know who (if anyone) is signed in.
  if (!authReady) {
    return (
      <div dir="rtl" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
        טוען…
      </div>
    )
  }
  if (!user) return <Login />

  const owned = watchlist.map((w) => w.symbol)
  const results = open ? searchCatalog(q, { excludeSymbols: owned, market }) : []
  const rawTicker = q.trim().toUpperCase()
  const canAddRaw =
    q.trim().length > 0 && !results.some((r) => r.symbol === rawTicker) && !owned.includes(rawTicker)

  const catalogSyms = new Set(results.map((r) => r.symbol))
  const ownedSet = new Set(owned)
  const remoteFiltered = remoteResults
    .filter((r) => (market === 'US' ? !r.symbol.endsWith('.TA') : r.symbol.endsWith('.TA')))
    .filter((r) => !ownedSet.has(r.symbol) && !catalogSyms.has(r.symbol))
    .slice(0, 6)

  const addRemote = (r) => {
    const kind = r.quoteType === 'INDEX' ? 'index' : r.quoteType === 'ETF' ? 'etf' : 'equity'
    add({ symbol: r.symbol, nameHe: r.name, priceSymbol: r.symbol, kind, market: r.symbol.endsWith('.TA') ? 'IL' : 'US' })
  }

  const loadQuote = (priceSym) => {
    if (!priceSym) return
    quoteSymbol(priceSym).then((s) => s && setLiveQuotes((prev) => ({ ...prev, [priceSym]: s })))
  }

  const add = async (item) => {
    try {
      await addToWatchlist(user.uid, item)
      setQ('')
      setOpen(false)
      const ps = item.priceSymbol || item.symbol
      loadQuote(ps) // instant price, don't wait for the poller
      primeInstrument(ps, item.nameHe, item.kind === 'index') // generate reviews now, not at morning
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
      const manualAdded = []
      for (const h of holdings) {
        const match = matchInstrument(h.name)
        if (match) {
          const ps = match.priceSymbol || match.symbol
          await addToWatchlist(user.uid, { ...match, quantity: h.quantity ?? undefined })
          loadQuote(ps)
          primeInstrument(ps, match.nameHe, match.kind === 'index')
          added++
        } else {
          // Not in the catalog — resolve the name to a real Yahoo ticker so it behaves like any
          // other stock (live price, chart, reviews). Only if that fails do we fall back to manual.
          const resolved = await resolveSymbol(h.name)
          if (resolved) {
            const kind = resolved.quoteType === 'INDEX' ? 'index' : resolved.quoteType === 'ETF' ? 'etf' : 'equity'
            const market = resolved.symbol.endsWith('.TA') ? 'IL' : 'US'
            await addToWatchlist(user.uid, { symbol: resolved.symbol, nameHe: h.name.trim(), priceSymbol: resolved.symbol, kind, market, quantity: h.quantity ?? undefined })
            loadQuote(resolved.symbol)
            primeInstrument(resolved.symbol, h.name.trim(), resolved.quoteType === 'INDEX')
            added++
          } else {
            // Truly unresolvable — add with manual pricing so nothing is dropped.
            const sym = 'X-' + h.name.trim().replace(/[/.#$[\]]/g, '-').slice(0, 40)
            await addToWatchlist(user.uid, { symbol: sym, nameHe: h.name.trim(), priceSymbol: sym, kind: 'other', quantity: h.quantity ?? undefined })
            primeInstrument(sym, h.name.trim(), false)
            manualAdded.push(h.name.trim())
            added++
          }
        }
      }
      setImportMsg(
        `זוהו ${holdings.length} · נוספו/עודכנו ${added}` +
          (manualAdded.length ? ` · הזן מחיר ידני ל: ${manualAdded.join(', ')}` : ''),
      )
    } catch (err) {
      setImportMsg('⚠️ ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const stocks = watchlist.map((w) => {
    const priceSym = w.priceSymbol || w.symbol
    const snap = snapshots[priceSym] || liveQuotes[priceSym]
    const mkt = w.market || 'IL'
    // IL ETFs (index proxy) and 'other' (small-caps) are priced manually; everything else
    // (equities, indices, US ETFs like SPY/QQQ) uses the live Yahoo price.
    const isIlEtf = mkt === 'IL' && w.kind === 'etf'
    const needsPrice = isIlEtf || w.kind === 'other'
    const effectivePrice = w.manualPrice != null ? w.manualPrice : needsPrice ? null : snap?.priceIls
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
      priceSymbol: priceSym,
      nameHe: w.nameHe,
      badge: isFlag(w.symbol, { kind: w.kind, isIndex: snap?.isIndex })
        ? { flag: true }
        : { logo: logoUrl(w.symbol) },
      subtitle: isIlEtf ? 'עוקב ת"א 35' : w.kind === 'other' ? 'מחיר ידני' : w.symbol,
      thresholdPct: w.thresholdPct,
      quantity: w.quantity,
      sector: sectorOf(w.symbol),
      market: mkt,
      currency: mkt === 'US' ? '$' : '₪',
      needsPrice,
      manualPrice: w.manualPrice,
      isIndex: needsPrice ? false : snap?.isIndex,
      priceIls: effectivePrice,
      changePct: snap?.changePct,
      series: snap?.series || [],
      explanation: insight,
      periods: periods[priceSym] || null,
    }
  })

  const marketStocks = stocks.filter((s) => s.market === market)
  const totalValue = marketStocks.reduce(
    (sum, s) => sum + (s.quantity > 0 && s.priceIls != null ? s.quantity * s.priceIls : 0),
    0,
  )
  const totalCurrency = market === 'US' ? '$' : '₪'

  const lastUpdatedMs = Math.max(0, ...Object.values(snapshots).map((s) => s.updatedAt || 0))
  const lastUpdatedLabel = lastUpdatedMs
    ? new Date(lastUpdatedMs).toLocaleString('he-IL', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : '—'

  // Group rows by sector (banks, indices, ETFs…) in a fixed display order.
  const f = filter.trim().toLowerCase()
  const shownStocks = f
    ? marketStocks.filter((s) => `${s.nameHe} ${s.symbol} ${s.subtitle || ''} ${s.sector || ''}`.toLowerCase().includes(f))
    : marketStocks

  // Instruments sharing a priceSymbol (an index + its tracking ETFs) render as ONE unified card;
  // the shared review + chart show once, with a compact row per member. Everything else → sectors.
  const byPrice = {}
  shownStocks.forEach((s) => { (byPrice[s.priceSymbol] ||= []).push(s) })
  const families = Object.values(byPrice)
    .filter((arr) => arr.length > 1)
    .map((arr) => {
      const members = [...arr].sort((a, b) => (b.isIndex ? 1 : 0) - (a.isIndex ? 1 : 0))
      const rep = members.find((m) => m.isIndex)
        || members.find((m) => m.explanation?.kind === 'event' || m.explanation?.kind === 'brief')
        || members[0]
      const title = (members.find((m) => m.isIndex)?.nameHe || rep.nameHe).replace(/^מדד\s*/, '')
      return { priceSymbol: arr[0].priceSymbol, title, rep, members }
    })
  const familySyms = new Set(families.map((fam) => fam.priceSymbol))
  const singles = shownStocks.filter((s) => !familySyms.has(s.priceSymbol))

  const grouped = {}
  singles.forEach((s) => {
    ;(grouped[s.sector] ||= []).push(s)
  })
  const sectorsPresent = [
    ...SECTOR_ORDER.filter((sec) => grouped[sec]?.length),
    ...Object.keys(grouped).filter((sec) => !SECTOR_ORDER.includes(sec)),
  ]

  return (
    <div style={{ maxWidth: '100%', margin: '0 auto', padding: '10px 28px 60px' }}>
      <div style={{ textAlign: 'right', color: 'var(--text-dim)', fontSize: 12, marginBottom: 6 }}>
        עודכן לאחרונה: {lastUpdatedLabel} · המחירים מתרעננים אוטומטית כל ~5 דקות בשעות המסחר.
      </div>
      <header style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>StocksInsights</h1>
              <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>תובנות על מניות בשפה פשוטה</span>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: '5px 0 0' }}>
              נתונים לצורכי מידע בלבד — אינם מהווים ייעוץ השקעות · המחירים מתעדכנים באיחור של כ־15 דקות.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {totalValue > 0 && (
              <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>שווי תיק ({market === 'US' ? '🇺🇸' : '🇮🇱'})</div>
                <div style={{ fontSize: 21, fontWeight: 800, direction: 'ltr', textAlign: 'left' }}>{totalCurrency}{fmtIls(totalValue)}</div>
              </div>
            )}
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
            <div
              title={user.email || ''}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel)',
                border: '1px solid var(--border)', borderRadius: 10, padding: '5px 8px 5px 12px',
              }}
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="" width={26} height={26} style={{ borderRadius: '50%' }} referrerPolicy="no-referrer" />
              ) : (
                <span style={{
                  width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700,
                }}>
                  {(user.displayName || user.email || '?').trim().charAt(0).toUpperCase()}
                </span>
              )}
              <span style={{ fontSize: 13, color: 'var(--text)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.displayName || user.email}
              </span>
              <button
                onClick={() => signOutUser().catch((e) => setError(e.message))}
                title="התנתק"
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 13, cursor: 'pointer', padding: '2px 4px' }}
              >
                יציאה
              </button>
            </div>
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['IL', '🇮🇱 ישראל'], ['US', '🇺🇸 ארה"ב']].map(([m, lbl]) => (
          <button
            key={m}
            onClick={() => setMarket(m)}
            style={{
              background: market === m ? 'var(--accent)' : 'var(--panel)',
              color: market === m ? '#fff' : 'var(--text-dim)',
              border: '1px solid var(--border)', borderRadius: 10, padding: '8px 20px',
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {settingsOpen && (
        <Settings
          watchlist={watchlist}
          onClose={() => setSettingsOpen(false)}
          onUpdate={(symbol, thr) => updateThreshold(user.uid, symbol, thr).catch((e) => setError(e.message))}
          insightFontSize={insightSize}
          onInsightFontSize={changeInsightSize}
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

      {/* Search + upload, side by side */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', marginBottom: 8, maxWidth: 760, flexWrap: 'wrap' }}>
      <div ref={boxRef} style={{ position: 'relative', flex: 1, minWidth: 240 }}>
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
        {open && (results.length > 0 || remoteFiltered.length > 0 || canAddRaw) && (
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
                  {item.kind === 'etf' && item.market !== 'US' ? 'ת"א 35' : item.symbol}
                </span>
              </button>
            ))}
            {remoteFiltered.map((r) => (
              <button
                key={r.symbol}
                onClick={() => addRemote(r)}
                style={{
                  display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                  gap: 10, padding: '10px 14px', background: 'transparent', border: 'none',
                  borderBottom: '1px solid var(--border)', color: 'var(--text)', textAlign: 'start',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 500 }}>{r.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', direction: 'ltr' }}>{r.symbol}</span>
              </button>
            ))}
            {canAddRaw && (
              <button
                onClick={() => add({ symbol: rawTicker, nameHe: rawTicker, priceSymbol: rawTicker, kind: 'equity', market })}
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

        <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} style={{ display: 'none' }} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          title="העלה צילום מסך של התיק מאפליקציית הברוקר — נזהה אוטומטית את המניות והכמויות"
          style={{
            display: 'flex', alignItems: 'center', gap: 9, background: 'var(--accent)', border: 'none',
            borderRadius: 10, padding: '0 18px', color: '#fff', fontSize: 14, fontWeight: 600,
            whiteSpace: 'nowrap', cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.6 : 1,
          }}
        >
          <span style={{ fontSize: 19, lineHeight: 1 }}>📷</span>
          <span style={{ textAlign: 'start', lineHeight: 1.15 }}>
            {importing ? 'מזהה תיק…' : 'העלה תיק מצילום'}
            {!importing && <><br /><span style={{ fontSize: 10.5, fontWeight: 400, opacity: 0.85 }}>זיהוי מניות אוטומטי</span></>}
          </span>
        </button>
      </div>
      {importMsg && <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 16 }}>{importMsg}</div>}

      {marketStocks.length > 0 && (
        <div style={{ position: 'relative', maxWidth: 320, marginBottom: 12 }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder='🔎 סנן לפי שם, סמל או סקטור (טכנולוגיה, בנקים…)'
            style={{ width: '100%', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 12px', color: 'var(--text)', fontSize: 13.5 }}
          />
          {filter && (
            <button onClick={() => setFilter('')} title="נקה" style={{ position: 'absolute', insetInlineEnd: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 14, cursor: 'pointer' }}>✕</button>
          )}
        </div>
      )}

      {marketStocks.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', padding: '40px 0' }}>
          {market === 'US' ? 'אין מניות אמריקאיות במעקב. חפש למעלה (למשל: אפל, נאסד"ק) כדי להוסיף.' : 'עדיין אין מניות במעקב. חפש למעלה או העלה צילום מסך כדי להתחיל.'}
        </div>
      ) : shownStocks.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
          לא נמצאו מניות התואמות ל"{filter}".
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {families.map((fam) => (
            <FamilyCard
              key={fam.priceSymbol}
              title={fam.title}
              rep={fam.rep}
              members={fam.members}
              insightFontSize={insightSize}
              onRemove={(sym) => removeFromWatchlist(user.uid, sym)}
              onQuantity={(sym, qty) => updateQuantity(user.uid, sym, qty).catch((e) => setError(e.message))}
              onPrice={(sym, p) => updatePrice(user.uid, sym, p).catch((e) => setError(e.message))}
            />
          ))}
          {sectorsPresent.map((sec) => (
            <section key={sec}>
              <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: 'var(--text-dim)', borderBottom: '1px solid var(--border)', paddingBottom: 5 }}>
                {sec} <span style={{ fontWeight: 400, opacity: 0.7 }}>· {grouped[sec].length}</span>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {grouped[sec].map((s) => (
                  <StockTile
                    key={s.key}
                    stock={s}
                    insightFontSize={insightSize}
                    onRemove={() => removeFromWatchlist(user.uid, s.symbol)}
                    onQuantity={(qty) => updateQuantity(user.uid, s.symbol, qty).catch((e) => setError(e.message))}
                    onPrice={(p) => updatePrice(user.uid, s.symbol, p).catch((e) => setError(e.message))}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <footer style={{ marginTop: 28, textAlign: 'start', color: 'var(--text-dim)', fontSize: 11.5 }}>
        נתונים לצורכי מידע בלבד — אינם מהווים ייעוץ השקעות.
      </footer>
    </div>
  )
}
