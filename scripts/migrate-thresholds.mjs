// One-off migration: move watchlist docs still on the old auto-default thresholds
// (1% for index/etf, 3% for equities) to the new 0.5% default. Any other value was set
// deliberately by the user in Settings and is left untouched (listed in the output).
//
// Auth: same as scripts/poll.mjs — FIREBASE_SERVICE_ACCOUNT (JSON string) or
// GOOGLE_APPLICATION_CREDENTIALS.
// Usage: `FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" node scripts/migrate-thresholds.mjs [--dry-run]`
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const OLD_DEFAULTS = new Set([1, 3])
const NEW_DEFAULT = 0.5

function initApp() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (raw) return initializeApp({ credential: cert(JSON.parse(raw)) })
  return initializeApp({ credential: applicationDefault() })
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const db = getFirestore(initApp())
  const docs = (await db.collection('watchlist').get()).docs

  const batch = db.batch()
  let migrated = 0
  const custom = []
  for (const d of docs) {
    const thr = d.get('thresholdPct')
    if (OLD_DEFAULTS.has(thr)) {
      console.log(`migrate ${d.id}: ${thr}% → ${NEW_DEFAULT}%`)
      batch.update(d.ref, { thresholdPct: NEW_DEFAULT })
      migrated++
    } else if (thr != null && thr !== NEW_DEFAULT) {
      custom.push(`${d.id}: ${thr}%`)
    }
  }

  if (migrated && !dryRun) await batch.commit()
  console.log(`${dryRun ? '[dry-run] would migrate' : 'Migrated'} ${migrated}/${docs.length} watchlist doc(s) to ${NEW_DEFAULT}%.`)
  if (custom.length) console.log(`Left ${custom.length} custom threshold(s) untouched:\n  ${custom.join('\n  ')}`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
