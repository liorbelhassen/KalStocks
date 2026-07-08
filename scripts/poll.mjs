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

  const wl = await db.collection('watchlist').get()
  const symbols = new Set(['TA35.TA'])
  wl.forEach((d) => {
    const p = d.get('priceSymbol') || d.get('symbol')
    if (p) symbols.add(p) // ETFs share the TA35.TA proxy — Set dedupes automatically
  })

  const snapshots = await fetchSnapshots([...symbols])
  const batch = db.batch()
  let ok = 0
  for (const snap of snapshots) {
    if (snap.error) {
      console.warn(`skip ${snap.symbol}: ${snap.error}`)
      continue
    }
    batch.set(db.collection('snapshots').doc(snap.symbol), { ...snap, updatedAt: Date.now() }, { merge: true })
    ok++
  }
  await batch.commit()
  console.log(`Polled ${ok}/${snapshots.length} symbols → snapshots.`)
  // TODO Phase 3: volatility detection → events; Phase 4: explanations.
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
