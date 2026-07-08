// Phase 4 — explanation engine. Uses Google Gemini with Google Search grounding, so it scans
// global news (any language) in real time and explains a move in plain Hebrew, for free.
// REST API (no SDK) to keep deps light.

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

export async function explainMove(
  { nameHe, symbol, changePct, direction, date, swingPct, reason },
  apiKey,
  model = DEFAULT_MODEL,
) {
  const pct = Math.abs(changePct ?? 0).toFixed(1)
  const dirHe = direction === 'up' ? 'עלתה' : 'ירדה'
  const moveDesc =
    reason === 'intraday-swing'
      ? `הראתה תנודתיות תוך-יומית חריגה (טווח של כ-${(swingPct ?? 0).toFixed(1)}%)`
      : `${dirHe} בכ-${pct}%`

  const prompt = `המניה "${nameHe}" (${symbol}) בבורסת תל אביב ${moveDesc} בתאריך ${date}.
חפש בחדשות מכל העולם ובכל שפה את הסיבות הסבירות לתנועה הזו (אירועי חברה, דוחות, מאקרו, גאופוליטיקה, ענף).
הסבר בעברית פשוטה ועממית, 2-3 משפטים, כאילו אתה מסביר לחבר שאינו איש שוק ההון — למה זה כנראה קרה.
אם אין חדשה ברורה שמסבירה את התנועה, אמור זאת בכנות ואל תמציא סיבה.
החזר אך ורק אובייקט JSON תקין (בלי טקסט נוסף) במבנה:
{"explanation":"<ההסבר בעברית>","confidence":"נמוכה|בינונית|גבוהה"}
confidence = עד כמה החדשות תומכות בהסבר. זה אינו ייעוץ השקעות.`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.3 },
    }),
  })
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  const data = await res.json()
  const cand = data.candidates?.[0]
  const text = (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join('').trim()

  // Sources come from grounding metadata (more reliable than asking the model to list them).
  const chunks = cand?.groundingMetadata?.groundingChunks || []
  const sources = [...new Set(chunks.map((c) => c.web?.title || c.web?.uri).filter(Boolean))].slice(0, 5)

  // Parse the JSON the model returns; fall back to raw text if parsing fails.
  let explanation = text
  let confidence = 'בינונית'
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      const j = JSON.parse(m[0])
      if (j.explanation) explanation = String(j.explanation).trim()
      if (j.confidence) confidence = String(j.confidence).trim()
    } catch {
      /* keep raw text */
    }
  }

  return { explanation, confidence, sources, model }
}
