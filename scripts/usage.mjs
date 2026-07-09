// Daily free-tier usage report (09:00 Israel). Reads the self-counted usage doc for the last
// complete day and emails a summary vs the free-tier limits.
//
// Env: FIREBASE_SERVICE_ACCOUNT (or GOOGLE_APPLICATION_CREDENTIALS), RESEND_API_KEY, DIGEST_TO.
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { DateTime } from 'luxon'
import { buildUsageHtml } from '../lib/usage.js'

const TZ = 'Asia/Jerusalem'

function initApp() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (raw) return initializeApp({ credential: cert(JSON.parse(raw)) })
  return initializeApp({ credential: applicationDefault() })
}

async function main() {
  const db = getFirestore(initApp())
  const now = DateTime.now().setZone(TZ)
  const yesterday = now.minus({ days: 1 })
  const yStr = yesterday.toISODate()

  const usage = (await db.collection('usage').doc(yStr).get()).data() || {}
  const html = buildUsageHtml({
    dateStr: yesterday.setLocale('he').toFormat('cccc, d LLLL yyyy'),
    refLabel: `ל־${yStr}`,
    usage,
  })

  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.DIGEST_TO
  if (!apiKey || !to) {
    console.log(`RESEND_API_KEY/DIGEST_TO not set — built usage HTML (${html.length} chars) but not sending.`)
    return
  }
  const from = process.env.DIGEST_FROM || 'StocksInsights <onboarding@resend.dev>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: `📊 מוניטור מכסות StocksInsights · ${yStr}`, html }),
  })
  const body = await res.text()
  if (!res.ok) {
    console.warn(`Usage email not sent — Resend ${res.status}: ${body.slice(0, 200)}`)
    return
  }
  console.log(`Usage report sent to ${to}.`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
