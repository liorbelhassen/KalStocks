// Morning pre-market brief (09:00 Israel). For each watched instrument, Gemini + Google Search
// grounding researches overnight/global news and gives a plain-Hebrew assessment of how the stock
// is likely to OPEN. Forward-looking → framed explicitly as a news-based assessment, NOT a
// prediction or investment advice.

import { badgeHtml } from './logos.js'
import { askWithSearch, cleanInsight, isWeak } from './llm.js'
import { marketOf } from './periods.js'
import { validateInsight } from './validate.js'

const UP = '#26a269'
const DOWN = '#e5484d'
const NEUTRAL = '#8b949e'

const fmt = (n) => (n ?? 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const sentimentColor = (s) =>
  s === 'חיובי' ? UP : s === 'שלילי' ? DOWN : NEUTRAL

/**
 * Build the daily brief prompt. Exported (pure) for tests. `market` ('IL' | 'US') decides which
 * exchange/session the text describes — a US stock at 09:00 Israel has NOT opened yet, so its
 * `changePct` is the last completed US session, not "today's trading".
 */
export function buildAssessPrompt({ nameHe, symbol, market, date, isIndex, session = 'morning', changePct = null, newsContext = '' }) {
  if (!nameHe) throw Object.assign(new Error('missing nameHe'), { stage: 'input' })
  if (!date) throw Object.assign(new Error(`missing date for ${symbol || nameHe}`), { stage: 'input' })
  const us = (market || marketOf(symbol)) === 'US'
  const subject = isIndex ? `מדד "${nameHe}"` : symbol ? `המניה "${nameHe}" (סימול ${symbol})` : `המניה "${nameHe}"`
  const exchange = us ? 'בבורסה האמריקאית (וול סטריט)' : 'בבורסת תל אביב'
  const dirWord = isIndex ? (changePct >= 0 ? 'עלה' : 'ירד') : (changePct >= 0 ? 'עלתה' : 'ירדה')
  const when = us ? 'בסשן המסחר האמריקאי האחרון (וול סטריט סגורה בשעות הבוקר/הצהריים בישראל)' : 'ביום המסחר הנוכחי'
  // The assessment MUST match the real move direction (don't say "rising" when it's down).
  const move =
    changePct != null && Number.isFinite(changePct) && Math.abs(changePct) >= 0.1
      ? `\nעובדה מחייבת: ${isIndex ? 'המדד' : 'המניה'} ${dirWord} ב-${Math.abs(changePct).toFixed(2)}% ${when}. ההסבר והסנטימנט חייבים להיות עקביים עם כיוון זה — הסבר מדוע ${dirWord}, ואל תסתור את הכיוון.`
      : ''
  const context = us
    ? `התאריך היום ${date}. ${subject} נסחר ${exchange}; המסחר בארה"ב טרם נפתח היום. תן סקירה על ${subject}.${move}
חקור מה קרה בסשן המסחר האמריקאי האחרון ומאז: חדשות החברה והענף, מאקרו וריבית בארה"ב, חוזים עתידיים, מסחר באסיה ובאירופה —
והסבר בעברית פשוטה מה הניע את הנייר ומה צפוי להשפיע עליו בפתיחה הקרובה בוול סטריט. אל תתייחס לבורסת תל אביב או לאירועים בישראל אלא אם יש קשר מפורש לחברה.`
    : session === 'midday'
      ? `כעת אמצע יום המסחר בתאריך ${date}, ${exchange}. תן עדכון צהריים על ${subject}.${move}
חקור מה קורה בעולם ובשוק כרגע ומאז פתיחת המסחר היום: שוקי אירופה, חוזים עתידיים בארה"ב, מאקרו,
גאופוליטיקה, חדשות על החברה ועל הענף — והסבר בעברית פשוטה מה מניע את הנייר עד כה היום ומה הצפי להמשך היום.`
      : `זהו בוקר ${date}, לפני/סביב פתיחת המסחר ${exchange}. תן סקירת בוקר על ${subject}.${move}
חקור מה קרה מאז סגירת המסחר הקודמת ובמהלך הלילה: סגירת שוקי ארה"ב, מסחר באסיה ובאירופה, מאקרו,
גאופוליטיקה, חדשות על החברה ועל הענף — כל מה שעשוי להשפיע על הנייר היום, והסבר בעברית פשוטה כיצד צפוי הנייר להיפתח/להיסחר ולמה.`
  const geo = us
    ? 'זהו נייר אמריקאי — הגורמים הרלוונטיים הם חדשות החברה, הענף, מאקרו וריבית בארה"ב ומדדי וול סטריט.'
    : 'כולל מצב ביטחוני וגאופוליטי (הסלמה, מתקפות, מלחמה, מתיחות אזורית) — שהוא לרוב הגורם המרכזי לתנועות רוחביות בבורסת תל אביב. אם עלה אירוע ספציפי, ציין אותו בשמו (מי/מה/היכן), לא רק "מתיחות".'
  return `${context}${newsContext || ''}
כתוב 3-4 משפטים עשירים, מעמיקים ומחכימים בעברית פשוטה — ציין גורמים ספציפיים (דוח, מספר, אירוע בחברה, מגמת ענף, נעילת וול סטריט, החלטת ריבית, אירוע גאופוליטי) והוסף הקשר והשלכות, לא רק את המובן מאליו.
קריטי — דיוק: חפש את האירוע/החדשה הדומיננטית שמניעה את השוק היום. ${geo} בסס את ההסבר אך ורק על הנתונים שסופקו כאן ועל חדשות אמת שמצאת בחיפוש; אל תמציא סיבות פיננסיות (כמו "העלאת ריבית", "דוחות מאכזבים") שלא אימתת בפועל. אל תערבב עם חברה אחרת בעלת שם או סימול דומה. אם כל השוק זז יחד (תנועה רוחבית) — הסבר את הסיבה המערכתית האמיתית, לא סיבה ספציפית לחברה.
אסור בתכלית: משפטים כלליים וריקים כמו "מומלץ לעקוב", "תלוי בשוק", "בטווח צר", "אין מידע", "קשה להעריך"; תשובה קצרה מדי; או המצאת עובדות.
כתוב בעברית בלבד — בלי אנגלית, בלי קישורים/מקורות, בלי markdown, בלי כותרות. עשיר ומעמיק (250-425 תווים), בלי לחזור על אותו מידע ובלי אמירות טריוויאליות שכל אחד יכול לנחש. זו הערכה על סמך חדשות, לא ייעוץ השקעות.
הקפד על דקדוק והתאמת מין: "המניה"/"החברה"/"הקרן" נקבה (עלתה/ירדה/נסחרה); "המדד"/"הנייר" זכר (עלה/ירד/נסחר).
החזר בדיוק שלוש שורות בפורמט הזה (ההערכה בשורה האחרונה):
סנטימנט: חיובי|שלילי|מעורב|ניטרלי
ביטחון: נמוכה|בינונית|גבוהה
הערכה: <ההערכה בעברית, 2-3 משפטים מהותיים>`
}

const parseAssessment = (text) => cleanInsight(text.match(/הערכה:\s*([\s\S]+)/)?.[1] || text)

// Resolves only with a validated assessment; throws (stage 'input' | 'llm' | 'validate') otherwise.
export async function assessOpen(input, keys) {
  const prompt = buildAssessPrompt(input)
  let res
  try {
    res = await askWithSearch(prompt, keys, { temperature: 0.4 })
  } catch (e) {
    throw Object.assign(new Error(e.message), { stage: 'llm' })
  }
  let { text, sources, provider } = res
  let assessment = parseAssessment(text)

  // If the model gave up or gave empty filler, force one deeper retry.
  if (isWeak(assessment) || !validateInsight(assessment).ok) {
    const r2 = await askWithSearch(
      `${prompt}\n\nהתשובה הקודמת הייתה חלשה מדי או אמרה "אין מידע" — זה אסור. חקור לעומק ותן הערכה קונקרטית ומהותית מבוססת חדשות/ענף/מאקרו.`,
      keys, { temperature: 0.5 },
    ).catch(() => null)
    if (r2) {
      const a2 = parseAssessment(r2.text)
      if (!isWeak(a2) && validateInsight(a2).ok) { assessment = a2; sources = r2.sources; provider = r2.provider; text = r2.text }
    }
  }
  const v = validateInsight(assessment)
  if (!v.ok) throw Object.assign(new Error(`rejected assessment for ${input.symbol || input.nameHe}: ${v.reason}`), { stage: 'validate' })

  // Line-based parse — robust to Hebrew gershayim (e.g. ארה"ב) that would break JSON strings.
  const sentiment = text.match(/סנטימנט:\s*(חיובי|שלילי|מעורב|ניטרלי)/)?.[1] || 'ניטרלי'
  const confidence = text.match(/ביטחון:\s*(נמוכה|בינונית|גבוהה)/)?.[1] || 'בינונית'

  return { assessment, sentiment, confidence, sources, provider }
}

export function buildMorningHtml({ dateStr, items = [], session = 'morning' }) {
  const midday = session === 'midday'
  const title = midday ? '🕐 עדכון צהריים — StocksInsights' : '☀️ סקירת בוקר — StocksInsights'
  const subtitle = midday
    ? 'מה מניע את הניירות שלך עד כה היום, על סמך מה שקורה בעולם.'
    : 'הערכה כיצד צפוי להיפתח המסחר בניירות שלך, על סמך חדשות הלילה.'
  const cards = items.length
    ? items
        .map((it) => {
          const color = sentimentColor(it.sentiment)
          const cur = it.currency || '₪'
          const price = it.priceIls != null ? (it.isIndex ? fmt(it.priceIls) : `${cur}${fmt(it.priceIls)}`) : ''
          const sources = (it.sources || []).length ? `מקורות: ${it.sources.join(', ')}` : ''
          return `
      <div dir="rtl" style="background:#f6f8fa;border:1px solid #e6e9ee;border-radius:10px;padding:14px 16px;margin:10px 0;text-align:right;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-size:16px;font-weight:700;">${badgeHtml(it.symbol, it.nameHe, { kind: it.kind, isIndex: it.isIndex })}${it.nameHe}</span>
          <span style="font-size:13px;font-weight:700;color:${color};">${it.sentiment || ''}</span>
        </div>
        ${price ? `<div style="font-size:12px;color:#6a737d;direction:ltr;text-align:right;">סגירה קודמת: ${price}</div>` : ''}
        <div style="font-size:14px;line-height:1.6;color:#24292f;margin-top:6px;">${it.assessment || ''}</div>
        <div style="font-size:12px;color:#6a737d;margin-top:6px;">ביטחון: ${it.confidence || '—'}${sources ? ' · ' + sources : ''}</div>
      </div>`
        })
        .join('')
    : `<p style="color:#6a737d;">אין ניירות במעקב.</p>`

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head>
  <body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#24292f;">
    <div dir="rtl" style="max-width:600px;margin:0 auto;padding:24px 20px;text-align:right;direction:rtl;">
      <h1 style="font-size:22px;margin:0 0 2px;">${title}</h1>
      <div style="color:#6a737d;font-size:13px;margin-bottom:6px;">${dateStr}</div>
      <div style="color:#6a737d;font-size:13px;margin-bottom:18px;">${subtitle}</div>
      ${cards}
      <p style="color:#8b949e;font-size:11px;margin-top:22px;line-height:1.6;">
        הערכה מקדימה על סמך חדשות זמינות — אינה תחזית ואינה ייעוץ השקעות. ייתכנו אי־דיוקים.
      </p>
    </div>
  </body></html>`
}
