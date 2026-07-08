// KalStocks Worker. Two actions:
//  - vision: a portfolio screenshot → Gemini Vision → detected holdings (Gemini key server-side).
//  - quote:  fetch a live Yahoo snapshot for a symbol (so a manually-added stock loads instantly,
//            without waiting for the scheduled poller — no Gemini involved).
import { fetchSnapshot } from '../lib/yahoo.js'

const ALLOWED = ['https://kalstocks1.web.app', 'http://localhost:5175', 'http://localhost:5173']

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
}
