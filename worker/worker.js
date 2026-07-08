// KalStocks Worker. Two actions:
//  - vision: a portfolio screenshot → Gemini Vision → detected holdings (Gemini key server-side).
//  - quote:  fetch a live Yahoo snapshot for a symbol (so a manually-added stock loads instantly,
//            without waiting for the scheduled poller — no Gemini involved).
import { fetchSnapshot, fetchSnapshots } from '../lib/yahoo.js'
import { getAccessToken, listDocs, patchDoc } from './firestore.js'

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

  // Cloudflare cron trigger — reliable 5-min price refresh.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pollPrices(env).catch((e) => console.log('cron poll error:', String(e))))
  },
}
