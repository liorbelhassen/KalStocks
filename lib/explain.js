// Explanation engine. Scans global news (any language) in real time via web search and
// explains a move in plain Hebrew. Gemini (free) first, OpenAI (paid) fallback — see lib/llm.js.
//
// Contract: resolves ONLY with a validated explanation (non-empty, Hebrew, bounded length, not
// filler). Anything else throws an Error tagged with `stage` ('input' | 'llm' | 'validate') so
// callers log it and do not save a blank/garbage text.

import { askWithSearch, cleanInsight, isWeak } from './llm.js'
import { marketOf } from './periods.js'
import { validateInsight, MAX_INSIGHT_LEN } from './validate.js'

const PERIOD_HE = { week: 'בשבוע האחרון', month: 'בחודש האחרון' }

function fail(stage, message) {
  const e = new Error(message)
  e.stage = stage
  return e
}

/**
 * Build the prompt. Exported (pure) so tests can assert what data actually reaches the model.
 * Throws stage='input' when the numbers needed to describe the move are missing — we never ask
 * the model to explain a move we cannot state.
 */
export function buildExplainPrompt({ nameHe, symbol, market, changePct, direction, date, swingPct, reason, period = 'day', window = null, newsContext = '' }) {
  if (!nameHe || !symbol) throw fail('input', 'missing nameHe/symbol')
  const isSwing = period === 'day' && reason === 'intraday-swing'
  if (!isSwing && (changePct == null || !Number.isFinite(changePct))) throw fail('input', `missing changePct for ${symbol} (${period})`)
  if (isSwing && (swingPct == null || !Number.isFinite(swingPct))) throw fail('input', `missing swingPct for ${symbol}`)
  if (!date) throw fail('input', `missing date for ${symbol}`)

  const mkt = market || marketOf(symbol)
  const pct = Math.abs(changePct ?? 0).toFixed(1)
  const dir = direction || ((changePct ?? 0) >= 0 ? 'up' : 'down')
  const dirHe = dir === 'up' ? 'עלה' : 'ירד' // masculine — modifies "הנייר" (זכר)
  const exchangeHe = mkt === 'US' ? 'בבורסה האמריקאית (וול סטריט)' : 'בבורסת תל אביב'
  const ident = `הנייר "${nameHe}" (סימול ${symbol}, נסחר ${exchangeHe})`

  let context
  if (period === 'week' || period === 'month') {
    const periodHe = PERIOD_HE[period]
    const span = window?.startDate && window?.endDate ? ` — התקופה המדויקת: מ-${window.startDate} עד ${window.endDate}` : ` (נכון ל-${date})`
    context = `${ident} ${dirHe} בכ-${pct}% ${periodHe}${span}.
חפש בחדשות מכל העולם ובכל שפה את המגמות והגורמים המרכזיים שהניעו את הנייר לאורך התקופה הזו בלבד (דוחות, מאקרו, גאופוליטיקה, ענף, אירועי חברה).
התייחס רק לאירועים שקרו בתוך התקופה הזו; אל תסביר תנועה של יום בודד ואל תשתמש בחדשות ישנות יותר.
הסבר בעברית פשוטה ועממית, 2-3 משפטים, את התנהגות הנייר לאורך ${periodHe}.`
  } else {
    const moveDesc = isSwing
      ? `הראה תנודתיות תוך-יומית חריגה (טווח של כ-${(swingPct ?? 0).toFixed(1)}%)`
      : `${dirHe} בכ-${pct}%`
    context = `${ident} ${moveDesc} ביום המסחר ${date}.
חפש בחדשות מכל העולם ובכל שפה את הסיבות הסבירות לתנועה הזו דווקא ביום הזה (אירועי חברה, דוחות, מאקרו, גאופוליטיקה, ענף).
הסבר בעברית פשוטה ועממית, 2-3 משפטים, כאילו אתה מסביר לחבר שאינו איש שוק ההון — למה זה כנראה קרה.`
  }

  // Hour-level headlines are relevant to a day move only; for a week/month they push the model to
  // attribute the whole period to today's news (the "stale/irrelevant" symptom).
  const news = period === 'day' ? newsContext || '' : ''

  const marketDriver =
    mkt === 'US'
      ? `זהו נייר אמריקאי: הגורמים הרלוונטיים הם חדשות החברה, הענף, נתוני מאקרו וריבית בארה"ב, ומדדי וול סטריט. אל תייחס את התנועה לאירועים ביטחוניים או פוליטיים בישראל אלא אם מצאת חדשה מפורשת שמקשרת ביניהם.`
      : `כולל מצב ביטחוני וגאופוליטי (הסלמה, מתקפות, מלחמה, מתיחות אזורית) — שהוא לרוב הגורם המרכזי לתנועות רוחביות בבורסת תל אביב. אם עלה אירוע ספציפי, ציין אותו בשמו (מי/מה/היכן), לא רק "מתיחות".`

  return `${context}${news}
חקור לעומק חדשות עדכניות על החברה, על הענף שלה ועל השוק הרחב (מדדים, ריבית, מאקרו, גאופוליטיקה).
כתוב 3-4 משפטים עשירים, מעמיקים ומחכימים — ציין גורמים ספציפיים (דוח כספי, מספר, אירוע בחברה, מגמת ענף, החלטת ריבית, אירוע גאופוליטי) והוסף הקשר והשלכות, לא רק את המובן מאליו.
קריטי — דיוק: חפש את האירוע/החדשה הדומיננטית שמניעה את השוק. ${marketDriver}
בסס את ההסבר אך ורק על הנתונים שסופקו לך כאן ועל חדשות אמת שמצאת; ההסבר חייב להיות עקבי עם הכיוון והגודל של התנועה שצוינו (${dirHe} ${pct}%). אל תמציא סיבות פיננסיות (כמו "העלאת ריבית", "דוחות מאכזבים") שלא אימתת. אל תערבב עם חברה אחרת בעלת שם או סימול דומה. אם כל השוק זז יחד — הסבר את הסיבה המערכתית האמיתית, לא סיבה ספציפית לחברה.
אסור בתכלית: משפטים כלליים וריקים כמו "מומלץ לעקוב", "תלוי בשוק", "בטווח צר", "אין מידע"; תשובה קצרה מדי (פחות משני משפטים); או המצאת עובדות.
כתוב בעברית פשוטה בלבד — בלי אנגלית, בלי קישורים/מקורות, בלי markdown, בלי כותרות. עשיר ומעמיק (250-${MAX_INSIGHT_LEN} תווים), בלי לחזור על אותו מידע ובלי אמירות טריוויאליות שכל אחד יכול לנחש.
הקפד על דקדוק והתאמת מין: "המניה"/"החברה"/"הקרן" נקבה (עלתה/ירדה/נסחרה); "המדד"/"הנייר" זכר (עלה/ירד/נסחר).
החזר בדיוק שתי שורות בפורמט הזה (ההסבר בשורה האחרונה):
ביטחון: נמוכה|בינונית|גבוהה
הסבר: <ההסבר בעברית, 2-3 משפטים מהותיים>`
}

const parseExplanation = (text) => cleanInsight(text.match(/הסבר:\s*([\s\S]+)/)?.[1] || text)

export async function explainMove(input, keys) {
  const prompt = buildExplainPrompt(input) // throws stage='input' on missing data

  let res
  try {
    res = await askWithSearch(prompt, keys, { temperature: 0.3 })
  } catch (e) {
    throw fail('llm', e.message)
  }
  let { text, sources, provider } = res
  let explanation = parseExplanation(text)

  // If the model gave up ("no news"), returned nothing, or a bald one-liner, force one deeper retry.
  if (isWeak(explanation) || !validateInsight(explanation).ok) {
    const r2 = await askWithSearch(
      `${prompt}\n\nהתשובה הקודמת הייתה חלשה מדי או אמרה "אין מידע" — זה אסור. חקור לעומק חדשות של החברה, הענף והשוק הרחב, ותן הסבר קונקרטי ומהותי.`,
      keys, { temperature: 0.5 },
    ).catch(() => null)
    if (r2) {
      const e2 = parseExplanation(r2.text)
      if (!isWeak(e2) && validateInsight(e2).ok) { explanation = e2; sources = r2.sources; provider = r2.provider; text = r2.text }
    }
  }

  const v = validateInsight(explanation, { mustMention: input.nameHe })
  if (!v.ok) throw fail('validate', `rejected explanation for ${input.symbol} (${input.period || 'day'}): ${v.reason}`)

  const confidence = text.match(/ביטחון:\s*(נמוכה|בינונית|גבוהה)/)?.[1] || 'בינונית'
  return { explanation, confidence, sources, provider, warning: v.warning || null }
}
