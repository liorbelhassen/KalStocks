// KalStocks poller — runs on a schedule (GitHub Actions cron) instead of a Firebase
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

const TZ = 'Asia/Jerusalem'

// TASE trades Sun–Thu, ~09:30–17:15 Israel time. Skip outside hours.
function isTaseOpen(now = DateTime.now().setZone(TZ)) {
  const dow = now.weekday // 1=Mon … 7=Sun
  const isTradingDay = dow === 7 || (dow >= 1 && dow <= 4)
  const minutes = now.hour * 60 + now.minute
  return isTradingDay && minutes >= 9 * 60 + 30 && minutes <= 17 * 60 + 20
}

function initApp() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (raw) return initializeApp({ credential: cert(JSON.parse(raw)) })
  return initializeApp({ credential: applicationDefault() }) // local: GOOGLE_APPLICATION_CREDENTIALS
}

async function main() {
  const force = process.argv.includes('--force')
  if (!force && !isTaseOpen()) {
    console.log('TASE closed — skipping poll. (use --force to override)')
    return
  }

  const db = getFirestore(initApp())

  const items = (await db.collection('watchlist').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
  const priceSymbols = new Set(['TA35.TA'])
  items.forEach((it) => {
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
      console.warn(`skip ${snap.symbol}: ${snap.error}`)
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
  for (const it of items) {
    const snap = byPrice[it.priceSymbol || it.symbol]
    if (!snap) continue
    const thr = it.thresholdPct || 3
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
    if (fresh) flagged++
  }
  console.log(`Volatility: ${flagged} new/worsening event(s) flagged for explanation.`)
  // TODO Phase 4: read events where needsExplanation==true → generate explanation → clear flag.
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
