// Sends a portfolio screenshot to the Cloudflare Worker (which calls Gemini Vision server-side)
// and returns the detected holdings: [{ name, quantity }]. URL comes from VITE_VISION_URL.
const VISION_URL = import.meta.env.VITE_VISION_URL

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1]) // strip "data:...;base64,"
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Live Yahoo snapshot for a symbol via the Worker (instant load on manual add).
export async function quoteSymbol(symbol) {
  if (!VISION_URL) return null
  try {
    const res = await fetch(VISION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'quote', symbol }),
    })
    const data = await res.json().catch(() => ({}))
    return res.ok ? data.snapshot || null : null
  } catch {
    return null
  }
}

// Live Yahoo search by name/ticker → [{symbol, name, exchange, quoteType}]. Finds any stock.
export async function searchYahoo(query) {
  if (!VISION_URL || !query || query.trim().length < 2) return []
  try {
    const res = await fetch(VISION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', query }),
    })
    const data = await res.json().catch(() => ({}))
    return res.ok ? data.results || [] : []
  } catch {
    return []
  }
}

// Resolve a (possibly Hebrew) instrument name to a real Yahoo ticker so it's treated like any
// other stock. Returns { symbol, name, quoteType } or null. Used when an imported name isn't in
// the catalog — avoids dead 'other' entries.
export async function resolveSymbol(name) {
  if (!VISION_URL || !name || !name.trim()) return null
  try {
    const res = await fetch(VISION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve', name: name.trim() }),
    })
    const data = await res.json().catch(() => ({}))
    return res.ok && data.symbol ? data : null
  } catch {
    return null
  }
}

// Fire-and-forget: ask the Worker to generate today/week/month reviews for a just-added instrument,
// so they appear within seconds. The dashboard's Firestore subscriptions pick them up when ready.
export function primeInstrument(symbol, nameHe, isIndex) {
  if (!VISION_URL || !symbol || !nameHe) return
  fetch(VISION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'prime', symbol, nameHe, isIndex: !!isIndex }),
  }).catch(() => {})
}

export async function analyzeScreenshot(file) {
  if (!VISION_URL) throw new Error('שירות הזיהוי טרם הוגדר (VITE_VISION_URL).')
  const imageBase64 = await fileToBase64(file)
  const res = await fetch(VISION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType: file.type || 'image/png' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const raw = `${data.detail || ''} ${data.error || ''}`
    if (data.status === 429 || /quota|exceeded|rate limit|too many/i.test(raw)) {
      const retry = (raw.match(/retry in ([\d.]+)s/i) || [])[1]
      const secs = retry ? Math.ceil(Number(retry)) : 60
      throw new Error(`מכסת ה-AI החינמית מלאה כרגע (מגבלה של בקשות לדקה). נסו שוב בעוד כ-${secs} שניות.`)
    }
    throw new Error(data.detail || data.error || `שגיאת שרת (${res.status})`)
  }
  return data.holdings || []
}
