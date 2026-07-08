// Morning pre-market brief (09:00 Israel) — GitHub Actions cron.
// Researches overnight news per watched instrument and emails a plain-Hebrew "how it may open" brief.
//
// Env: FIREBASE_SERVICE_ACCOUNT (or GOOGLE_APPLICATION_CREDENTIALS), GEMINI_API_KEY,
//      RESEND_API_KEY, DIGEST_TO, DIGEST_FROM (optional).
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { DateTime } from 'luxon'
import { assessOpen, buildMorningHtml } from '../lib/morning.js'
import { bumpUsage } from '../lib/usage.js'

const TZ = 'Asia/Jerusalem'

function initApp() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (raw) return initializeApp({ credential: cert(JSON.parse(raw)) })
  return initializeApp({ credential: applicationDefault() })
}

async function main() {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) {
    console.log('GEMINI_API_KEY not set — cannot build morning brief.')
    return
  }
  const db = getFirestore(initApp())
  const now = DateTime.now().setZone(TZ)
  const dateStr = now.toISODate()
  const dateHe = now.setLocale('he').toFormat('cccc, d LLLL yyyy')

  const items = (await db.collection('watchlist').get()).docs.map((d) => d.data())
  const snaps = {}
  ;(await db.collection('snapshots').get()).forEach((d) => (snaps[d.id] = d.data()))

  // Assess once per unique priceSymbol (ETFs share the TA-35 proxy).
  const groups = new Map()
  for (const w of items) {
    const ps = w.priceSymbol || w.symbol
    if (!groups.has(ps)) groups.set(ps, { priceSymbol: ps, repName: w.nameHe, isIndex: snaps[ps]?.isIndex })
    if (snaps[ps]?.isIndex) groups.get(ps).repName = w.nameHe // prefer index name if present
  }

  const assessments = {}
  let geminiCalls = 0
  for (const g of groups.values()) {
    try {
      geminiCalls++
      assessments[g.priceSymbol] = await assessOpen(
        { nameHe: g.repName, symbol: g.priceSymbol, date: dateStr, isIndex: !!g.isIndex },
        geminiKey,
      )
    } catch (e) {
      console.warn(`assess failed for ${g.priceSymbol}: ${e.message}`)
    }
  }
  await bumpUsage(db, dateStr, { geminiCalls })

  const emailItems = items.map((w) => {
    const ps = w.priceSymbol || w.symbol
    const a = assessments[ps] || {}
    return {
      symbol: w.symbol,
      nameHe: w.nameHe,
      kind: w.kind,
      isIndex: snaps[ps]?.isIndex,
      priceIls: snaps[ps]?.priceIls,
      assessment: a.assessment || 'לא נמצאה הערכה.',
      sentiment: a.sentiment,
      confidence: a.confidence,
      sources: a.sources,
    }
  })

  const html = buildMorningHtml({ dateStr: dateHe, items: emailItems })

  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.DIGEST_TO
  if (!apiKey || !to) {
    console.log(`RESEND_API_KEY/DIGEST_TO not set — built morning HTML (${html.length} chars) but not sending.`)
    return
  }
  const from = process.env.DIGEST_FROM || 'KalStocks <onboarding@resend.dev>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: `☀️ סקירת בוקר KalStocks · ${dateStr}`, html }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`)
  await bumpUsage(db, dateStr, { emailsSent: 1 })
  console.log(`Morning brief sent to ${to}.`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
