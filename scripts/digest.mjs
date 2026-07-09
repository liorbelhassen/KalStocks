// Phase 6 — twice-daily email digest. Runs on GitHub Actions cron (mid-session + post-close).
// Reads today's data from Firestore and emails a plain-Hebrew summary via Resend.
//
// Env: FIREBASE_SERVICE_ACCOUNT (or GOOGLE_APPLICATION_CREDENTIALS), RESEND_API_KEY,
//      DIGEST_TO (recipient), DIGEST_FROM (optional, defaults to Resend's sandbox sender).
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { DateTime } from 'luxon'
import { buildDigestHtml } from '../lib/digest.js'
import { bumpUsage } from '../lib/usage.js'

const TZ = 'Asia/Jerusalem'

function initApp() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (raw) return initializeApp({ credential: cert(JSON.parse(raw)) })
  return initializeApp({ credential: applicationDefault() })
}

async function main() {
  const db = getFirestore(initApp())
  const now = DateTime.now().setZone(TZ)
  const dateStr = now.toISODate()
  const dateHe = now.setLocale('he').toFormat('cccc, d LLLL yyyy')
  const timeLabel = now.hour < 15 ? 'אמצע יום' : 'סוף יום'

  // Watched instruments + their latest snapshots.
  const items = (await db.collection('watchlist').get()).docs.map((d) => d.data())
  const kindBy = {}
  items.forEach((w) => (kindBy[w.symbol] = w.kind))
  const snaps = {}
  ;(await db.collection('snapshots').get()).forEach((d) => (snaps[d.id] = d.data()))

  const all = items.map((w) => {
    const s = snaps[w.priceSymbol || w.symbol] || {}
    return { symbol: w.symbol, nameHe: w.nameHe, kind: w.kind, priceIls: s.priceIls, changePct: s.changePct, isIndex: s.isIndex }
  })

  // Today's significant movers, joined with their explanations.
  const movers = []
  const evSnap = await db.collection('events').where('date', '==', dateStr).get()
  for (const d of evSnap.docs) {
    const ev = d.data()
    const exp = (await db.collection('explanations').doc(d.id).get()).data()
    movers.push({
      symbol: ev.symbol,
      nameHe: ev.nameHe,
      kind: kindBy[ev.symbol],
      changePct: ev.changePct,
      direction: ev.direction,
      explanation: exp?.explanation || 'טרם נוצר הסבר.',
      confidence: exp?.confidence,
      sources: exp?.sources,
    })
  }
  movers.sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))

  const html = buildDigestHtml({ dateStr: dateHe, timeLabel, movers, all })

  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.DIGEST_TO
  if (!apiKey || !to) {
    console.log(`RESEND_API_KEY/DIGEST_TO not set — built HTML (${html.length} chars) but not sending.`)
    return
  }
  const from = process.env.DIGEST_FROM || 'StocksInsights <onboarding@resend.dev>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: `StocksInsights — סיכום ${timeLabel} · ${dateStr}`, html }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`)
  await bumpUsage(db, dateStr, { emailsSent: 1 })
  console.log(`Digest sent to ${to}. ${body.slice(0, 120)}`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
