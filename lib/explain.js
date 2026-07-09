// Phase 4 — explanation engine. Scans global news (any language) in real time via web search and
// explains a move in plain Hebrew. Gemini (free) first, OpenAI (paid) fallback — see lib/llm.js.

import { askWithSearch } from './llm.js'

export async function explainMove(
  { nameHe, symbol, changePct, direction, date, swingPct, reason, period = 'day' },
  keys,
) {
  const pct = Math.abs(changePct ?? 0).toFixed(1)
  const dirHe = direction === 'up' ? 'עלה' : 'ירד' // masculine — modifies "הנייר" (זכר) in the context below

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
הקפד על דקדוק עברי והתאמת מין: "המניה"/"החברה"/"הקרן" בלשון נקבה (עלתה/ירדה/נסחרה/זינקה); "המדד"/"הנייר" בלשון זכר (עלה/ירד/נסחר/זינק).
החזר בדיוק שתי שורות בפורמט הזה (ההסבר בשורה האחרונה):
ביטחון: נמוכה|בינונית|גבוהה
הסבר: <ההסבר בעברית>
ביטחון = עד כמה החדשות תומכות בהסבר. זה אינו ייעוץ השקעות.`

  const { text, sources, provider } = await askWithSearch(prompt, keys, { temperature: 0.3 })

  // Line-based parse — robust to Hebrew gershayim (e.g. ארה"ב) that would break JSON strings.
  const confidence = text.match(/ביטחון:\s*(נמוכה|בינונית|גבוהה)/)?.[1] || 'בינונית'
  const explanation = (text.match(/הסבר:\s*([\s\S]+)/)?.[1] || text).replace(/```/g, '').trim()

  return { explanation, confidence, sources, provider }
}
