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
import { fetchSnapshot } from '../lib/yahoo.js'
import { explainMove } from '../lib/explain.js'

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
  const session = now.hour < 12 ? 'morning' : 'midday' // morning run (~09:00) vs midday run (~13:00)

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
        { nameHe: g.repName, symbol: g.priceSymbol, date: dateStr, isIndex: !!g.isIndex, session },
        geminiKey,
      )
    } catch (e) {
      console.warn(`assess failed for ${g.priceSymbol}: ${e.message}`)
    }
  }
  // Persist assessments as dashboard "baseline insights" (so every stock always shows something).
  let briefWrites = 0
  for (const [ps, a] of Object.entries(assessments)) {
    await db.collection('briefs').doc(`${ps}__${dateStr}`).set({
      priceSymbol: ps,
      date: dateStr,
      session,
      assessment: a.assessment,
      sentiment: a.sentiment,
      confidence: a.confidence,
      sources: a.sources || [],
      at: Date.now(),
    })
    briefWrites++
  }
  await bumpUsage(db, dateStr, { geminiCalls, firestoreWrites: briefWrites })

  // Once a day (morning): compute week/month period data + explanations → periods/{priceSymbol}.
  if (session === 'morning') {
    const priceSyms = new Set()
    items.forEach((w) => {
      if (w.kind !== 'other') priceSyms.add(w.priceSymbol || w.symbol)
    })
    const pchg = (snap) => {
      const v = (snap.series || []).map((p) => p.v).filter((x) => x != null)
      return v.length > 1 ? ((v[v.length - 1] - v[0]) / v[0]) * 100 : 0
    }
    let periodCalls = 0
    for (const ps of priceSyms) {
      try {
        const repName = groups.get(ps)?.repName || ps
        const wk = await fetchSnapshot(ps, { range: '5d', interval: '30m' })
        const mo = await fetchSnapshot(ps, { range: '1mo', interval: '1d' })
        const wkChg = pchg(wk)
        const moChg = pchg(mo)
        const wkExp = await explainMove({ nameHe: repName, symbol: ps, changePct: wkChg, direction: wkChg >= 0 ? 'up' : 'down', date: dateStr, period: 'week' }, geminiKey).catch(() => null)
        const moExp = await explainMove({ nameHe: repName, symbol: ps, changePct: moChg, direction: moChg >= 0 ? 'up' : 'down', date: dateStr, period: 'month' }, geminiKey).catch(() => null)
        periodCalls += 2
        await db.collection('periods').doc(ps).set({
          symbol: ps,
          updatedAt: Date.now(),
          week: { changePct: Math.round(wkChg * 100) / 100, series: wk.series || [], explanation: wkExp?.explanation || null, confidence: wkExp?.confidence || null, sources: wkExp?.sources || [] },
          month: { changePct: Math.round(moChg * 100) / 100, series: mo.series || [], explanation: moExp?.explanation || null, confidence: moExp?.confidence || null, sources: moExp?.sources || [] },
        })
      } catch (e) {
        console.warn(`period failed for ${ps}: ${e.message}`)
      }
    }
    await bumpUsage(db, dateStr, { geminiCalls: periodCalls, firestoreWrites: priceSyms.size })
    console.log(`Periods: updated ${priceSyms.size} symbols.`)
  }

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

  // The midday run refreshes the dashboard insight only — no email (the 13:00 digest covers email).
  if (session !== 'morning') {
    console.log(`Midday brief: refreshed ${briefWrites} dashboard insights (no email).`)
    return
  }

  const html = buildMorningHtml({ dateStr: dateHe, items: emailItems, session })

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
