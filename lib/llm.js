// Provider-agnostic "ask with live web search" — the single entry point for news-grounded
// Hebrew explanations. Tries Gemini first (free tier), and on ANY failure (quota/429/error)
// falls back to OpenAI (paid) if a key is configured. This is what makes assessments reliable:
// Gemini's free-tier throughput ceiling no longer means a missing assessment.
//
// keys = { geminiKey, geminiModel, openaiKey, openaiModel }
import { geminiSearch } from './gemini.js'
import { openaiSearch } from './openai.js'

export async function askWithSearch(prompt, keys = {}, { temperature = 0.4 } = {}) {
  const { geminiKey, geminiModel, openaiKey, openaiModel } = keys
  let geminiErr
  if (geminiKey) {
    try {
      // If OpenAI is available, don't burn time retrying a rate-limited Gemini — fail fast and fall
      // back immediately. Without a fallback, retry Gemini (it's all we have).
      return await geminiSearch(prompt, geminiKey, geminiModel, temperature, openaiKey ? 0 : 2)
    } catch (e) {
      geminiErr = e
      if (!openaiKey) throw e // no fallback available
      // else fall through to OpenAI
    }
  }
  if (openaiKey) {
    try {
      return await openaiSearch(prompt, openaiKey, openaiModel)
    } catch (e) {
      // Surface both failures so logs show why the assessment is missing.
      throw new Error(`both providers failed — gemini: ${geminiErr?.message || 'n/a'} | openai: ${e.message}`)
    }
  }
  throw geminiErr || new Error('no LLM key configured (set GEMINI_API_KEY and/or OPENAI_API_KEY)')
}

// Clean a model's Hebrew answer: strip markdown links/urls/headers/symbols and any mostly-English
// boilerplate lines (OpenAI's web_search sometimes appends English "stock information" blocks).
const MAX_INSIGHT = 425

// A "weak" answer = the model gave up, gave empty filler, or is too shallow/short. → forceful retry.
export function isWeak(text) {
  const t = (text || '').trim()
  return t.length < 120 || /לא נמצא|אין מידע|אין נתונ|אין חדש|קשה להערי|מומלץ לעקוב|תלוי בשוק/.test(t)
}

// Cross-engine fact-check: verify an insight with the OTHER engine (independent web search) to catch
// hallucinations (e.g. "rocket fire" that never happened). Returns a corrected, verified version —
// or the original if no second engine is available or verification fails.
export async function verifyInsight(text, subject, keys = {}, genProvider = '') {
  if (!text) return text
  const genIsOpenAI = genProvider.startsWith('openai')
  let vKeys = null
  if (genIsOpenAI && keys.geminiKey) vKeys = { geminiKey: keys.geminiKey, geminiModel: keys.geminiModel }
  else if (!genIsOpenAI && keys.openaiKey) vKeys = { openaiKey: keys.openaiKey, openaiModel: keys.openaiModel }
  if (!vKeys) return text // only one engine configured → can't cross-check
  const prompt = `לפניך תובנה כלכלית בעברית על ${subject}:
"${text}"
משימתך: אמת כל טענה עובדתית מול חדשות עדכניות ואמיתיות (חפש ברשת עכשיו). היזהר במיוחד מהזיות — אירועים שלא קרו, נתונים שגויים, או ייחוס סיבה לא נכונה.
קריטי — טענות ביטחוניות: אם התובנה מזכירה אירוע ביטחוני (ירי רקטות/טילים, מתקפה, פיגוע, מלחמה, הסלמה) — אמת שהוא באמת קרה בימים האחרונים לפי חדשות מפורשות. אם אין אישור עדכני וברור — הסר את הטענה לחלוטין. אל תניח אירוע ביטחוני על סמך העבר (למשל "ירי מעזה" לא היה כבר שנים).
החזר גרסה סופית בעברית המבוססת אך ורק על עובדות מאומתות: הסר או תקן כל טענה שגויה/לא מאומתת, אך שמור על תובנה עשירה, מעמיקה ומחכימה (3-4 משפטים). בלי אנגלית, בלי קישורים, בלי markdown. החזר אך ורק את התובנה הסופית עצמה.`
  try {
    const { text: v } = await askWithSearch(prompt, vKeys, { temperature: 0.2 })
    const cleaned = cleanInsight(v)
    return cleaned && !isWeak(cleaned) ? cleaned : text
  } catch {
    return text
  }
}

export function cleanInsight(s) {
  const stripped = (s || '')
    .replace(/\(\[[^\]]*\]\([^)]*\)\)/g, '') // ([title](url))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [title](url) → title
    .replace(/https?:\/\/\S+/g, '') // bare urls
    .replace(/\([^)]*\.(com|net|org|co\.il|io)[^)]*\)/gi, '') // (domain.com) source refs
    .replace(/[*_`>#]/g, '') // markdown symbols
  const heLines = stripped
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false
      const he = (l.match(/[֐-׿]/g) || []).length
      const en = (l.match(/[A-Za-z]/g) || []).length
      return he >= en // drop lines that are mostly English (boilerplate)
    })
  let out = heLines.join(' ').replace(/\s+/g, ' ').trim()

  // Drop duplicate sentences (models sometimes repeat the same point).
  const seen = new Set()
  out = out
    .split(/(?<=[.!?])\s+/)
    .filter((sent) => {
      const k = sent.trim().toLowerCase()
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
    .join(' ')
    .trim()

  // Hard cap — cut at the last full sentence before the limit.
  if (out.length > MAX_INSIGHT) {
    const cut = out.slice(0, MAX_INSIGHT)
    const lastEnd = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'))
    out = (lastEnd > MAX_INSIGHT * 0.5 ? cut.slice(0, lastEnd + 1) : cut).trim()
  }
  return out
}
