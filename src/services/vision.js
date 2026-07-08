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
