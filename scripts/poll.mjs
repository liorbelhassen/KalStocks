// StocksInsights poller — runs on a schedule (GitHub Actions cron) instead of a Firebase
// Cloud Function, so the project stays on the free Spark plan (no Blaze).
// Fetches watched symbols from Yahoo and writes normalized snapshots to Firestore
// via the Admin SDK (bypasses security rules).
//
// Auth: set FIREBASE_SERVICE_ACCOUNT to the service-account JSON (as a string).
// Local run: `FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" npm run poll`
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { DateTime } from 'luxon'
import { fetchSnapshots } from '../lib/yahoo.js'
import { classify } from '../lib/volatility.js'
import { explainMove } from '../lib/explain.js'
import { fetchHeadlines, buildNewsContext } from '../lib/telegram.js'
import { marketOf } from '../lib/periods.js'
import { logEvent } from '../lib/validate.js'
import { bumpUsage } from '../lib/usage.js'

const TZ = 'Asia/Jerusalem'

// Open if TASE (Sun–Thu 09:30–17:20 Israel) OR US markets (Mon–Fri 09:30–16:00 New York) are open.
function isMarketOpen() {
  const il = DateTime.now().setZone(TZ)
  const ilMin = il.hour * 60 + il.minute
  const taseOpen = il.weekday >= 1 && il.weekday <= 5 && ilMin >= 570 && ilMin <= 1040 // TASE trades Mon–Fri (Luxon: Mon=1..Fri=5)
  const ny = DateTime.now().setZone('America/New_York')
  const nyMin = ny.hour * 60 + ny.minute
  const usOpen = ny.weekday >= 1 && ny.weekday <= 5 && nyMin >= 570 && nyMin < 960
  return taseOpen || usOpen
}

function initApp() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (raw) return initializeApp({ credential: cert(JSON.parse(raw)) })
  return initializeApp({ credential: applicationDefault() }) // local: GOOGLE_APPLICATION_CREDENTIALS
}

async function main() {
  const force = process.argv.includes('--force')
  if (!force && !isMarketOpen()) {
    console.log('Markets closed — skipping poll. (use --force to override)')
    return
  }

  const db = getFirestore(initApp())

  const items = (await db.collection('watchlist').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
  const priceSymbols = new Set(['TA35.TA'])
  items.forEach((it) => {
    if (it.kind === 'other') return // manual-price stocks aren't on Yahoo — don't fetch
    const p = it.priceSymbol || it.symbol
    if (p) priceSymbols.add(p) // ETFs share the TA35.TA proxy — Set dedupes automatically
  })

  // 1) Fetch + store snapshots.
  const snapshots = await fetchSnapshots([...priceSymbols])
  const byPrice = {}
  const batch = db.batch()
  let ok = 0
  for (const snap of snapshots) {
    if (snap.error) {
      logEvent('warn', { stage: 'price', symbol: snap.symbol, error: snap.error })
      continue
    }
    byPrice[snap.symbol] = snap
    batch.set(db.collection('snapshots').doc(snap.symbol), { ...snap, updatedAt: Date.now() }, { merge: true })
    ok++
  }
  await batch.commit()
  console.log(`Polled ${ok}/${snapshots.length} symbols → snapshots.`)

  // 2) Phase 3 — volatility detection → events.
  // One event doc per (instrument, trading day). Re-flag needsExplanation only when the move grows
  // into a higher band, so Phase 4 explains a fresh/worsening move but not every 15-min tick.
  const dateStr = DateTime.now().setZone(TZ).toISODate()
  let flagged = 0
  let eventWrites = 0
  for (const it of items) {
    const snap = byPrice[it.priceSymbol || it.symbol]
    if (!snap) continue
    const thr = it.thresholdPct || 0.5
    const c = classify(snap, thr)
    if (!c.significant) continue

    const ref = db.collection('events').doc(`${it.symbol}__${dateStr}`)
    const existing = await ref.get()
    const prevBand = existing.exists ? existing.get('band') || 0 : 0
    const fresh = !existing.exists || c.band > prevBand

    await ref.set(
      {
        symbol: it.symbol,
        nameHe: it.nameHe || it.symbol,
        priceSymbol: it.priceSymbol || it.symbol,
        date: dateStr,
        at: Date.now(),
        changePct: c.change,
        direction: c.direction,
        swingPct: Math.round(c.swingPct * 100) / 100,
        band: Math.max(c.band, prevBand),
        reason: c.reason,
        thresholdPct: thr,
        ...(fresh ? { needsExplanation: true } : {}),
      },
      { merge: true },
    )
    eventWrites++
    if (fresh) flagged++
  }
  console.log(`Volatility: ${flagged} new/worsening event(s) flagged for explanation.`)

  // 3) Phase 4 — generate explanations for flagged events (Gemini free, OpenAI paid fallback).
  const keys = {
    geminiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL,
    openaiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
    openaiVerifyModel: process.env.OPENAI_VERIFY_MODEL,
  }
  let geminiCalls = 0
  let explanationWrites = 0
  if (keys.geminiKey || keys.openaiKey) {
    const pending = await db.collection('events').where('needsExplanation', '==', true).get()
    const headlines = pending.size ? await fetchHeadlines() : []
    let explained = 0
    for (const d of pending.docs) {
      const ev = d.data()
      // Never explain a previous day's event with today's headlines — retire it instead.
      if (ev.date !== dateStr) {
        logEvent('warn', { stage: 'explain', symbol: ev.symbol, period: 'day', date: ev.date, error: 'stale unexplained event retired' })
        await d.ref.update({ needsExplanation: false })
        continue
      }
      try {
        geminiCalls++
        const market = marketOf(ev.priceSymbol || ev.symbol)
        const news = buildNewsContext(headlines, { market, nameHe: ev.nameHe, symbol: ev.priceSymbol || ev.symbol })
        const r = await explainMove({ ...ev, market, newsContext: news }, keys)
        await db.collection('explanations').doc(d.id).set({
          symbol: ev.symbol,
          nameHe: ev.nameHe,
          date: ev.date,
          changePct: ev.changePct,
          direction: ev.direction,
          explanation: r.explanation,
          confidence: r.confidence,
          sources: r.sources,
          model: r.provider,
          at: Date.now(),
        })
        await d.ref.update({ needsExplanation: false, explainedAt: Date.now() })
        explanationWrites += 2
        explained++
      } catch (e) {
        logEvent('warn', { stage: e.stage || 'llm', symbol: ev.symbol, period: 'day', date: ev.date, changePct: ev.changePct, error: e.message })
      }
    }
    console.log(`Explanations: generated ${explained}.`)
  } else {
    console.log('GEMINI_API_KEY not set — skipping explanations.')
  }

  // 4) Self-count usage for the free-tier monitor (+1 for this bump write).
  await bumpUsage(db, dateStr, {
    firestoreWrites: ok + eventWrites + explanationWrites + 1,
    geminiCalls,
  })
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
