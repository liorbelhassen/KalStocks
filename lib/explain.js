// Phase 4 — explanation engine. Scans global news (any language) in real time via web search and
// explains a move in plain Hebrew. Gemini (free) first, OpenAI (paid) fallback — see lib/llm.js.

import { askWithSearch, cleanInsight, isWeak } from './llm.js'

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
חקור לעומק חדשות עדכניות על החברה, על הענף שלה ועל השוק הרחב (מדדים, ריבית, מאקרו, גאופוליטיקה).
כתוב 2-3 משפטים מלאים, מהותיים וקונקרטיים — ציין גורמים ספציפיים (דוח כספי, מספר, אירוע בחברה, מגמת ענף, החלטת ריבית, אירוע גאופוליטי).
אסור בתכלית: משפטים כלליים וריקים כמו "מומלץ לעקוב", "תלוי בשוק", "בטווח צר", "אין מידע"; תשובה קצרה מדי (פחות משני משפטים); או המצאת עובדות.
אם אין חדשה ספציפית על החברה — עגן את ההסבר במגמת הענף ובשוק הרחב, אבל תמיד תן תובנה מהותית ולא סתמית.
כתוב בעברית פשוטה בלבד — בלי אנגלית, בלי קישורים/מקורות, בלי markdown, בלי כותרות. תמציתי, בלי לחזור על אותו מידע, עד 400 תווים.
הקפד על דקדוק והתאמת מין: "המניה"/"החברה"/"הקרן" נקבה (עלתה/ירדה/נסחרה); "המדד"/"הנייר" זכר (עלה/ירד/נסחר).
החזר בדיוק שתי שורות בפורמט הזה (ההסבר בשורה האחרונה):
ביטחון: נמוכה|בינונית|גבוהה
הסבר: <ההסבר בעברית, 2-3 משפטים מהותיים>`

  let { text, sources, provider } = await askWithSearch(prompt, keys, { temperature: 0.3 })
  let explanation = cleanInsight(text.match(/הסבר:\s*([\s\S]+)/)?.[1] || text)

  // If the model gave up ("no news") or a bald one-liner, force one deeper retry.
  if (isWeak(explanation)) {
    const r2 = await askWithSearch(
      `${prompt}\n\nהתשובה הקודמת הייתה חלשה מדי או אמרה "אין מידע" — זה אסור. חקור לעומק חדשות של החברה, הענף והשוק הרחב, ותן הסבר קונקרטי ומהותי.`,
      keys, { temperature: 0.5 },
    ).catch(() => null)
    if (r2) {
      const e2 = cleanInsight(r2.text.match(/הסבר:\s*([\s\S]+)/)?.[1] || r2.text)
      if (!isWeak(e2)) { explanation = e2; sources = r2.sources; provider = r2.provider; text = r2.text }
    }
  }

  const confidence = text.match(/ביטחון:\s*(נמוכה|בינונית|גבוהה)/)?.[1] || 'בינונית'
  return { explanation, confidence, sources, provider }
}
