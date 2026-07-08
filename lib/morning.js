// Morning pre-market brief (09:00 Israel). For each watched instrument, Gemini + Google Search
// grounding researches overnight/global news and gives a plain-Hebrew assessment of how the stock
// is likely to OPEN. Forward-looking → framed explicitly as a news-based assessment, NOT a
// prediction or investment advice.

import { badgeHtml } from './logos.js'

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const UP = '#26a269'
const DOWN = '#e5484d'
const NEUTRAL = '#8b949e'

const fmt = (n) => (n ?? 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const sentimentColor = (s) =>
  s === 'חיובי' ? UP : s === 'שלילי' ? DOWN : NEUTRAL

export async function assessOpen({ nameHe, symbol, date, isIndex, session = 'morning' }, apiKey, model = DEFAULT_MODEL) {
  const subject = isIndex ? `מדד "${nameHe}"` : `המניה "${nameHe}" (${symbol})`
  const context =
    session === 'midday'
      ? `כעת אמצע יום המסחר (בסביבות 13:00) בתאריך ${date}, בבורסת תל אביב. תן עדכון צהריים על ${subject}.
חקור מה קורה בעולם ובשוק כרגע ומאז פתיחת המסחר היום: שוקי אירופה, חוזים עתידיים בארה"ב, מאקרו,
גאופוליטיקה, חדשות על החברה ועל הענף — והסבר בעברית פשוטה מה מניע את הנייר עד כה היום ומה הצפי להמשך היום.`
      : `זהו בוקר ${date}, לפני/סביב פתיחת המסחר בבורסת תל אביב. תן סקירת בוקר על ${subject}.
חקור מה קרה מאז סגירת המסחר הקודמת ובמהלך הלילה: סגירת שוקי ארה"ב, מסחר באסיה ובאירופה, מאקרו,
גאופוליטיקה, חדשות על החברה ועל הענף — כל מה שעשוי להשפיע על הנייר היום, והסבר בעברית פשוטה כיצד צפוי הנייר להיפתח/להיסחר ולמה.`
  const prompt = `${context}
כתוב בעברית פשוטה ועממית (2-3 משפטים), שווה לכל נפש.
היה כן לגבי אי-ודאות — זו הערכה על סמך חדשות זמינות בלבד, לא תחזית ולא ייעוץ השקעות.
החזר בדיוק שלוש שורות בפורמט הזה (ההערכה בשורה האחרונה):
סנטימנט: חיובי|שלילי|מעורב|ניטרלי
ביטחון: נמוכה|בינונית|גבוהה
הערכה: <ההערכה בעברית>`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.4 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)

  const data = await res.json()
  const cand = data.candidates?.[0]
  const text = (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join('').trim()
  const chunks = cand?.groundingMetadata?.groundingChunks || []
  const sources = [...new Set(chunks.map((c) => c.web?.title || c.web?.uri).filter(Boolean))].slice(0, 5)

  // Line-based parse — robust to Hebrew gershayim (e.g. ארה"ב) that would break JSON strings.
  const sentiment = text.match(/סנטימנט:\s*(חיובי|שלילי|מעורב|ניטרלי)/)?.[1] || 'ניטרלי'
  const confidence = text.match(/ביטחון:\s*(נמוכה|בינונית|גבוהה)/)?.[1] || 'בינונית'
  const assessment = (text.match(/הערכה:\s*([\s\S]+)/)?.[1] || text).replace(/```/g, '').trim()

  return { assessment, sentiment, confidence, sources, model }
}

export function buildMorningHtml({ dateStr, items = [], session = 'morning' }) {
  const midday = session === 'midday'
  const title = midday ? '🕐 עדכון צהריים — KalStocks' : '☀️ סקירת בוקר — KalStocks'
  const subtitle = midday
    ? 'מה מניע את הניירות שלך עד כה היום, על סמך מה שקורה בעולם.'
    : 'הערכה כיצד צפוי להיפתח המסחר בניירות שלך, על סמך חדשות הלילה.'
  const cards = items.length
    ? items
        .map((it) => {
          const color = sentimentColor(it.sentiment)
          const price = it.priceIls != null ? (it.isIndex ? fmt(it.priceIls) : `₪${fmt(it.priceIls)}`) : ''
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
