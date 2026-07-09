// Phase 4 — explanation engine. Uses Google Gemini with Google Search grounding, so it scans
// global news (any language) in real time and explains a move in plain Hebrew, for free.
// REST API (no SDK) to keep deps light.

import { geminiWithRetry } from './gemini.js'

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

export async function explainMove(
  { nameHe, symbol, changePct, direction, date, swingPct, reason, period = 'day' },
  apiKey,
  model = DEFAULT_MODEL,
) {
  const pct = Math.abs(changePct ?? 0).toFixed(1)
  const dirHe = direction === 'up' ? 'עלתה' : 'ירדה'

  let context
  if (period === 'week' || period === 'month') {
    const periodHe = period === 'week' ? 'בשבוע האחרון' : 'בחודש האחרון'
    context = `הנייר "${nameHe}" (${symbol}) ${dirHe} בכ-${pct}% ${periodHe} (נכון ל-${date}).
חפש בחדשות מכל העולם ובכל שפה את המגמות והגורמים המרכזיים שהניעו את הנייר לאורך התקופה (דוחות, מאקרו, גאופוליטיקה, ענף, אירועי חברה).
הסבר בעברית פשוטה ועממית, 2-3 משפטים, את התנהגות הנייר לאורך ${periodHe}.`
  } else {
    const moveDesc =
      reason === 'intraday-swing'
        ? `הראה תנודתיות תוך-יומית חריגה (טווח של כ-${(swingPct ?? 0).toFixed(1)}%)`
        : `${dirHe} בכ-${pct}%`
    context = `הנייר "${nameHe}" (${symbol}) ${moveDesc} בתאריך ${date}.
חפש בחדשות מכל העולם ובכל שפה את הסיבות הסבירות לתנועה הזו (אירועי חברה, דוחות, מאקרו, גאופוליטיקה, ענף).
הסבר בעברית פשוטה ועממית, 2-3 משפטים, כאילו אתה מסביר לחבר שאינו איש שוק ההון — למה זה כנראה קרה.`
  }

  const prompt = `${context}
אם אין חדשה/מגמה ברורה, אמור זאת בכנות ואל תמציא סיבה.
החזר בדיוק שתי שורות בפורמט הזה (ההסבר בשורה האחרונה):
ביטחון: נמוכה|בינונית|גבוהה
הסבר: <ההסבר בעברית>
ביטחון = עד כמה החדשות תומכות בהסבר. זה אינו ייעוץ השקעות.`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const data = await geminiWithRetry(url, {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.3 },
  })
  const cand = data.candidates?.[0]
  const text = (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join('').trim()

  // Sources come from grounding metadata (more reliable than asking the model to list them).
  const chunks = cand?.groundingMetadata?.groundingChunks || []
  const sources = [...new Set(chunks.map((c) => c.web?.title || c.web?.uri).filter(Boolean))].slice(0, 5)

  // Line-based parse — robust to Hebrew gershayim (e.g. ארה"ב) that would break JSON strings.
  const confidence = text.match(/ביטחון:\s*(נמוכה|בינונית|גבוהה)/)?.[1] || 'בינונית'
  const explanation = (text.match(/הסבר:\s*([\s\S]+)/)?.[1] || text).replace(/```/g, '').trim()

  return { explanation, confidence, sources, model }
}
