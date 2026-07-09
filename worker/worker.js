// KalStocks Worker. Two actions:
//  - vision: a portfolio screenshot → Gemini Vision → detected holdings (Gemini key server-side).
//  - quote:  fetch a live Yahoo snapshot for a symbol (so a manually-added stock loads instantly,
//            without waiting for the scheduled poller — no Gemini involved).
import { fetchSnapshot, fetchSnapshots } from '../lib/yahoo.js'
import { getAccessToken, listDocs, patchDoc } from './firestore.js'
import { assessOpen, buildMorningHtml } from '../lib/morning.js'
import { explainMove } from '../lib/explain.js'

const ALLOWED = ['https://kalstocks1.web.app', 'http://localhost:5175', 'http://localhost:5173']

// Open if TASE (Israel, Sun–Thu) OR US markets (New York, Mon–Fri) are trading. DST-safe via Intl.
function minutesInZone(tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  return { wd: p.find((x) => x.type === 'weekday').value, min: +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value }
}
function marketOpen() {
  const il = minutesInZone('Asia/Jerusalem')
  const taseOpen = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(il.wd) && il.min >= 570 && il.min <= 1040
  const ny = minutesInZone('America/New_York')
  const usOpen = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(ny.wd) && ny.min >= 570 && ny.min < 960
  return taseOpen || usOpen
}

// Reliable 5-min price poll (Cloudflare cron). Writes snapshots to Firestore via REST.
async function pollPrices(env) {
  if (!env.SERVICE_ACCOUNT) return
  if (!marketOpen()) return
  const sa = JSON.parse(env.SERVICE_ACCOUNT)
  const token = await getAccessToken(sa)
  const wl = await listDocs(token, sa.project_id, 'watchlist')
  const symbols = new Set(['TA35.TA'])
  wl.forEach((w) => {
    if (w.kind === 'other') return // manual-price stocks aren't on Yahoo
    const p = w.priceSymbol || w.symbol
    if (p) symbols.add(p)
  })
  const snaps = await fetchSnapshots([...symbols])
  for (const snap of snaps) {
    if (snap.error) continue
    try {
      await patchDoc(token, sa.project_id, `snapshots/${encodeURIComponent(snap.symbol)}`, {
        ...snap,
        updatedAt: Date.now(),
      })
    } catch {
      /* skip one symbol on failure */
    }
  }
}

const ilDateISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
const ilDateHe = () =>
  new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())

// Morning brief — reliable 09:00 Israel (Cloudflare cron fires on time). Sends the email +
// writes today's briefs + week/month period data & explanations. Reuses the shared libs.
async function morningJob(env) {
  if (!env.SERVICE_ACCOUNT || !env.GEMINI_API_KEY) return
  if (Math.floor(minutesInZone('Asia/Jerusalem').min / 60) !== 9) return // only the 09:xx slot (DST-safe)

  const sa = JSON.parse(env.SERVICE_ACCOUNT)
  const token = await getAccessToken(sa)
  const pid = sa.project_id
  const dateStr = ilDateISO()

  const items = await listDocs(token, pid, 'watchlist')
  const snaps = {}
  ;(await listDocs(token, pid, 'snapshots')).forEach((s) => {
    if (s.symbol) snaps[s.symbol] = s
  })

  const groups = new Map()
  for (const w of items) {
    if (w.kind === 'other') continue
    const ps = w.priceSymbol || w.symbol
    if (!ps) continue
    if (!groups.has(ps)) groups.set(ps, { priceSymbol: ps, repName: w.nameHe, isIndex: snaps[ps]?.isIndex })
    if (snaps[ps]?.isIndex) groups.get(ps).repName = w.nameHe
  }

  const assessments = {}
  for (const g of groups.values()) {
    try {
      assessments[g.priceSymbol] = await assessOpen({ nameHe: g.repName, symbol: g.priceSymbol, date: dateStr, isIndex: !!g.isIndex, session: 'morning' }, env.GEMINI_API_KEY)
    } catch {
      /* skip */
    }
  }
  for (const [ps, a] of Object.entries(assessments)) {
    await patchDoc(token, pid, `briefs/${encodeURIComponent(`${ps}__${dateStr}`)}`, {
      priceSymbol: ps, date: dateStr, session: 'morning', assessment: a.assessment, sentiment: a.sentiment, confidence: a.confidence, sources: a.sources || [], at: Date.now(),
    })
  }

  const emailItems = items
    .filter((w) => w.kind !== 'other')
    .map((w) => {
      const ps = w.priceSymbol || w.symbol
      const a = assessments[ps] || {}
      return { symbol: w.symbol, nameHe: w.nameHe, kind: w.kind, isIndex: snaps[ps]?.isIndex, priceIls: snaps[ps]?.priceIls, assessment: a.assessment || 'לא נמצאה הערכה.', sentiment: a.sentiment, confidence: a.confidence, sources: a.sources }
    })
  const html = buildMorningHtml({ dateStr: ilDateHe(), items: emailItems, session: 'morning' })
  if (env.RESEND_API_KEY && env.DIGEST_TO) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.DIGEST_FROM || 'KalStocks <onboarding@resend.dev>', to: env.DIGEST_TO, subject: `☀️ סקירת בוקר KalStocks · ${dateStr}`, html }),
    })
  }

  // Week/month period data + explanations.
  const pchg = (snap) => {
    const v = (snap.series || []).map((p) => p.v).filter((x) => x != null)
    return v.length > 1 ? ((v[v.length - 1] - v[0]) / v[0]) * 100 : 0
  }
  for (const ps of groups.keys()) {
    try {
      const repName = groups.get(ps).repName || ps
      const wk = await fetchSnapshot(ps, { range: '5d', interval: '30m' })
      const mo = await fetchSnapshot(ps, { range: '1mo', interval: '1d' })
      const wc = pchg(wk)
      const mc = pchg(mo)
      const we = await explainMove({ nameHe: repName, symbol: ps, changePct: wc, direction: wc >= 0 ? 'up' : 'down', date: dateStr, period: 'week' }, env.GEMINI_API_KEY).catch(() => null)
      const me = await explainMove({ nameHe: repName, symbol: ps, changePct: mc, direction: mc >= 0 ? 'up' : 'down', date: dateStr, period: 'month' }, env.GEMINI_API_KEY).catch(() => null)
      await patchDoc(token, pid, `periods/${encodeURIComponent(ps)}`, {
        symbol: ps, updatedAt: Date.now(),
        week: { changePct: Math.round(wc * 100) / 100, series: wk.series || [], explanation: we?.explanation || null, confidence: we?.confidence || null, sources: we?.sources || [] },
        month: { changePct: Math.round(mc * 100) / 100, series: mo.series || [], explanation: me?.explanation || null, confidence: me?.confidence || null, sources: me?.sources || [] },
      })
    } catch {
      /* skip */
    }
  }
  console.log('morning job done for', dateStr)
}

function cors(origin) {
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}
const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } })

// Line format (NOT JSON) so Hebrew gershayim like ת"א don't break parsing.
const PROMPT = `זהו צילום מסך של תיק/רשימת מניות מאפליקציית מסחר (כנראה ישראלית).
זהה את ניירות הערך שמופיעים, ואם מוצגת כמות המניות המוחזקת מכל אחד — ציין אותה.
החזר כל אחזקה בשורה נפרדת בפורמט המדויק:  שם | כמות
(כמות = מספר, או ריק אם לא מוצג). בלי שום טקסט אחר, בלי כותרות.`

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) })
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin)
    try {
      const body = await request.json()

      // Action: search Yahoo by name/ticker — finds any stock, not just the catalog.
      if (body.action === 'search') {
        const q = (body.query || '').trim()
        if (q.length < 2) return json({ results: [] }, 200, origin)
        try {
          const r = await fetch(
            `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (KalStocks)' } },
          )
          const d = await r.json()
          const results = (d.quotes || [])
            .filter((x) => x.symbol && ['EQUITY', 'ETF', 'INDEX'].includes(x.quoteType))
            .map((x) => ({
              symbol: x.symbol,
              name: x.shortname || x.longname || x.symbol,
              exchange: x.exchange || '',
              quoteType: x.quoteType,
            }))
          return json({ results }, 200, origin)
        } catch (e) {
          return json({ error: 'search failed', detail: String(e) }, 502, origin)
        }
      }

      // Action: live quote for a single symbol (instant load on manual add).
      if (body.action === 'quote') {
        if (!body.symbol) return json({ error: 'missing symbol' }, 400, origin)
        try {
          const snapshot = await fetchSnapshot(body.symbol)
          return json({ snapshot }, 200, origin)
        } catch (e) {
          return json({ error: 'quote failed', detail: String(e) }, 502, origin)
        }
      }

      const { imageBase64, mimeType } = body
      if (!imageBase64) return json({ error: 'missing image' }, 400, origin)

      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType || 'image/png', data: imageBase64 } }] },
            ],
            generationConfig: { temperature: 0.1 },
          }),
        },
      )
      const data = await r.json()
      if (!r.ok) return json({ error: 'gemini', status: r.status, detail: data?.error?.message || '' }, 502, origin)

      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('\n')
      const holdings = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('|'))
        .map((line) => {
          const [name, qty] = line.split('|').map((s) => s.trim())
          const n = parseFloat((qty || '').replace(/[^\d.]/g, ''))
          return { name, quantity: Number.isFinite(n) ? n : null }
        })
        .filter((h) => h.name)

      return json({ holdings }, 200, origin)
    } catch (e) {
      return json({ error: String(e) }, 500, origin)
    }
  },

  // Cloudflare cron triggers (fire on time). */5 → price poll; 06:00/07:00 UTC → morning brief.
  async scheduled(event, env, ctx) {
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(pollPrices(env).catch((e) => console.log('cron poll error:', String(e))))
    } else {
      ctx.waitUntil(morningJob(env).catch((e) => console.log('cron morning error:', String(e))))
    }
  },
}
