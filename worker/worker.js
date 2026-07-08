// KalStocks vision proxy (Cloudflare Worker). Receives a portfolio screenshot from the browser,
// asks Gemini Vision which securities + quantities it shows, and returns them. The Gemini key
// stays server-side (Worker secret GEMINI_API_KEY) — never exposed in the public site.
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
      const { imageBase64, mimeType } = await request.json()
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
