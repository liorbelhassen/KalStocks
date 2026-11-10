// Adversarial fact-check of every AI market explanation before it is published. A search-grounded
// answer is not proof: the model can find a real headline (e.g. an IDF operation) and still invent
// the causal link to the move. An independent pass (different model, fresh context, its own search)
// challenges each claim against the measured market numbers and dated articles, then deterministic
// guards re-check the final text. Anything that fails is not published.
import { geminiSearch } from './gemini.js'
import { openaiSearch, hostOf } from './openai.js'
import { cleanInsight } from './llm.js'
import { validateInsight, logEvent, META_RE } from './validate.js'
import { measuredAnalysis } from './analysis.js'
import { siteName, yahooQuoteUrl, tidyUrl, URL_RE } from './sources.js'

export const DEFAULT_VERIFY_MODEL = 'gpt-5.4-mini'

const norm = (s) => (s || '').replace(/[״“”]/g, '"').replace(/[׳’]/g, "'")

export const GEO_RE = /לבנון|איראן|חיזבאללה|חמאס|עזה|תימן|חות'?י|סוריה|צה"ל|טיל|רקט|מתקפ|הסלמ|גאופוליט|גיאופוליט|ביטחונ|מלחמ|פיגוע|לחימה/
const US_RE = /וול סטריט|ארה"ב|אמריק|S&P|נאסד"ק|נאסדק|דאו|חוזים|גלובלי|עולמי|שוקי העולם/
const LOCAL_RE = /ת"א[- ]?35|ת"א[- ]?125|המדד|השוק|רוחבי|הבורסה|וול סטריט|ארה"ב|גלובלי/

const SECTOR_RE = /ענף|סקטור|מניות ה|מדד ה/

const fail = (stage, message) => Object.assign(new Error(message), { stage })

export const extractPercents = (text) =>
  [...norm(text).matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) => parseFloat(m[1].replace(',', '.')))

/**
 * Deterministic guards on a final text. `verified` = claims the checker tied to a real article.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function checkClaims(text, { changePct = null, facts = [], diagnosis = null, verified = [] } = {}) {
  const t = norm(text)
  const known = [changePct, diagnosis?.ref?.changePct, ...facts.map((f) => f.changePct)]
    .filter((n) => n != null && Number.isFinite(n)).map(Math.abs)
  verified.forEach((v) => known.push(...extractPercents(v.claim)))
  const unknown = extractPercents(t).filter((n) => !known.some((k) => Math.abs(n - k) <= Math.max(0.06, k * 0.08)))
  if (unknown.length) return { ok: false, reason: `unsupported-number:${unknown.join(',')}%` }
  if (META_RE.test(t)) return { ok: false, reason: 'meta-commentary' }
  if (GEO_RE.test(t) && !verified.some((v) => GEO_RE.test(norm(v.claim)))) return { ok: false, reason: 'unsupported-geopolitics' }
  if (diagnosis?.kind === 'sector-wide' && !SECTOR_RE.test(t) && !t.includes(norm(diagnosis.ref?.label))) return { ok: false, reason: 'ignores-sector-driver' }
  if (diagnosis?.kind === 'market-wide') {
    const re = US_RE.test(norm(diagnosis.ref?.label)) ? US_RE : LOCAL_RE
    if (!re.test(t)) return { ok: false, reason: 'ignores-market-driver' }
  }
  return { ok: true }
}

const cleanUrl = tidyUrl

/** Parse the checker's line format. Robust to Hebrew gershayim (no JSON). */
export function parseVerdict(text) {
  const t = text || ''
  const verdict = t.match(/פסק:\s*(אושר|תוקן|נדחה)/)?.[1] || null
  const section = (from, to) => {
    const m = t.match(new RegExp(`${from}:?\\s*\\n([\\s\\S]*?)(?:\\n\\s*(?:${to}))`))
    return (m?.[1] || '').split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter((l) => l && !/^אין\.?$/.test(l))
  }
  const verified = section('טענות מאומתות', 'נפסלו|ביטחון|הסבר סופי')
    .map((l) => {
      const url = l.match(URL_RE)?.[0]
      const [head, ...rest] = l.split('|')
      const claim = head.replace(/https?:\/\/\S+/g, '').trim()
      const ref = Number(rest.join('|').match(/#\s*(\d+)/)?.[1]) || null
      if (!claim) return null
      return url ? { claim, url: cleanUrl(url) } : ref ? { claim, ref } : null
    })
    .filter(Boolean)
  const rejected = section('נפסלו', 'ביטחון|הסבר סופי')
  const confidence = t.match(/ביטחון:\s*(נמוכה|בינונית|גבוהה)/)?.[1] || null
  const final = cleanInsight(t.match(/הסבר סופי:\s*([\s\S]+)/)?.[1] || '')
  return { verdict, verified, rejected, confidence, final }
}

export function buildChallengePrompt({ draft, subject, moveText, when, factsBlock, articlesBlock = '', kind = 'explanation' }) {
  const outlook =
    kind === 'assessment'
      ? 'הערכה לגבי המשך המסחר מותרת רק כהערכה זהירה ומותנית שנגזרת מעובדות שאומתו — לא כעובדה ולא כתחזית נחרצת.'
      : 'הסר תחזיות ("צפויה המשך ירידה" וכו\').'
  return `אתה בודק עובדות ספקן ועצמאי בדסק כלכלי. תפקידך לתפוס הזיות ו"סיפורים" לא מבוססים בהסבר לתנועת שוק לפני שהוא מתפרסם. הנחת המוצא: הטיוטה שגויה עד שהוכח אחרת.
הנייר: ${subject}. התנועה: ${moveText}. התקופה: ${when}.
${factsBlock || '(לא סופקו נתוני שוק מדודים)'}
${articlesBlock}
טיוטת ההסבר לבדיקה:
"""${draft}"""

חפש ברשת עכשיו ובדוק כל טענה בטיוטה לפי הכללים:
1. טענה סיבתית ("בעקבות", "על רקע", "נובעת מ", "בגלל") מתקבלת רק אם כתבה פיננסית מתוך התקופה (מהרשימה שסופקה או מחיפוש שלך) (${when}) שמקשרת במפורש בין הגורם לבין תנועת הנייר או השוק שלו. העובדה שאירוע קרה אינה מוכיחה שהוא הזיז את השוק.
2. טענה שסותרת את נתוני השוק המדודים נפסלת. אם הנתונים מראים שהתנועה תואמת את הענף (מדד הענף) או את השוק הרחב (למשל וול סטריט או החוזים העתידיים), ההסבר הסופי חייב לומר זאת כגורם המרכזי.
3. אירועים ביטחוניים או גאופוליטיים (לבנון, איראן, עזה, "מתיחות גאופוליטית", "הסלמה") מתקבלים רק אם כתבה פיננסית מהתקופה מייחסת להם במפורש את תנועת השוק הזה. "מתיחות" כללית בלי אירוע ספציפי ומקור נפסלת תמיד.
4. מספרים מותרים רק מתוך נתוני השוק שסופקו או מתוך כתבה שמצאת (וציינת ברשימת הטענות המאומתות).
5. ${outlook}
6. אסור להוסיף טענה חדשה שלא נמצאת ברשימת הטענות המאומתות או בנתוני השוק.
כתוב הסבר סופי שמכיל רק את מה שעבר את הבדיקה, בעברית פשוטה כמו שמסבירים לחבר שאינו איש שוק ההון: מה קרה ולמה. בלי להזכיר את הבדיקה, את הטיוטה, טענות שנפסלו או "כתבה מתאריך", ובלי שעות, שיאים ושפלים תוך-יומיים. אם שום גורם חדשותי לא אומת, הסבר לפי נתוני השוק בלבד (למשל שהנייר נע עם הענף שלו או עם השוק כולו) בלי לכתוב "לא נמצאה סיבה". אל תמציא.

החזר בדיוק בפורמט הזה:
פסק: אושר|תוקן|נדחה
טענות מאומתות:
- <טענה, כולל כל מספר שבה> | <מספר הכתבה מהרשימה (למשל #2) או כתובת URL מלאה של כתבה שמצאת>
(או "- אין")
נפסלו:
- <טענה שנפסלה> — <סיבה>
(או "- אין")
ביטחון: נמוכה|בינונית|גבוהה
הסבר סופי: <2-4 משפטים בעברית, 150-425 תווים, בלי קישורים, בלי markdown>`
}

async function askChecker(prompt, keys, allowedDomains) {
  if (keys.openaiKey) return openaiSearch(prompt, keys.openaiKey, keys.openaiVerifyModel || DEFAULT_VERIFY_MODEL, { allowedDomains })
  if (keys.geminiKey) return geminiSearch(prompt, keys.geminiKey, keys.geminiModel, 0.1, 1)
  throw new Error('no LLM key configured for fact-checking')
}

/**
 * Challenge `draft`. Resolves { text, confidence, sources, verdict, verified, rejected } with a text
 * that passed both the checker and the deterministic guards — or a facts-only text when the numbers
 * alone explain the move. Throws stage='factcheck' otherwise (checker errors included: an
 * unchecked text is never published).
 */
export async function challengeInsight({ draft, subject, isIndex = false, moveText, when, periodHe, factsBlock, articles = [], articlesBlock = '', allowedDomains = null, facts = [], diagnosis = null, changePct = null, kind = 'explanation', fallback = null, log = {} }, keys = {}) {
  const prompt = buildChallengePrompt({ draft, subject, moveText, when, factsBlock, articlesBlock, kind })
  let res
  try {
    res = await askChecker(prompt, keys, allowedDomains)
  } catch (e) {
    throw fail('factcheck', `fact-check unavailable: ${e.message}`)
  }
  const p = parseVerdict(res.text)
  // A citation must be a supplied article or a page the checker's search actually returned (no
  // invented links).
  const seen = res.urls ? new Set(res.urls.map(hostOf)) : null
  const verified = p.verified
    .map((v) => {
      if (v.ref) { const a = articles[v.ref - 1]; return a ? { claim: v.claim, url: a.url, host: a.host } : null }
      return { ...v, host: hostOf(v.url) }
    })
    .filter((v) => v && (!seen || seen.has(v.host) || articles.some((a) => a.url === v.url)))
  const ctx = { changePct, facts, diagnosis, verified }

  let text = null
  let reason = null
  if (!p.verdict || !p.final) reason = 'unparseable-verdict'
  else if (p.verdict === 'נדחה') reason = 'checker-rejected'
  else if (!verified.length) reason = 'no-verified-claims'
  else {
    const shape = validateInsight(p.final, { minLen: 60 })
    const claims = shape.ok ? checkClaims(p.final, ctx) : { ok: false, reason: shape.reason }
    if (claims.ok) text = p.final
    else reason = claims.reason
  }

  const byHost = new Map()
  for (const v of verified) if (v.host && v.url && !byHost.has(v.host)) byHost.set(v.host, { name: siteName(v.host), url: v.url })
  let sources = [...byHost.values()].slice(0, 4)
  let confidence = p.confidence || 'בינונית'
  let outcome = p.verdict
  if (!text) {
    const fb = fallback || (['market-wide', 'sector-wide'].includes(diagnosis?.kind) ? measuredAnalysis({ subject, isIndex, changePct, periodHe, facts, diagnosis }) : null)
    if (!fb) {
      logEvent('warn', { stage: 'factcheck', ...log, verdict: p.verdict, reason, rejected: p.rejected.slice(0, 3) })
      throw fail('factcheck', `fact-check rejected ${log.symbol || subject} (${log.period || 'day'}): ${reason}`)
    }
    text = fb
    sources = []
    confidence = 'נמוכה'
    outcome = 'נתונים בלבד'
  }
  if (facts.length) sources.push({ name: 'Yahoo Finance', url: yahooQuoteUrl(log.symbol) })
  logEvent('info', { stage: 'factcheck', ...log, verdict: outcome, reason, verified: verified.length, rejected: p.rejected.slice(0, 3) })
  return { text, confidence, sources, verdict: outcome, verified, rejected: p.rejected, provider: res.provider }
}
