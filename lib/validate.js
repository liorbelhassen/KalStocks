// Output validation for LLM-generated Hebrew insights + structured failure logging.
// Shared by lib/explain.js, lib/morning.js, the Worker and the scripts.

export const MAX_INSIGHT_LEN = 425
export const MIN_INSIGHT_LEN = 80

// Phrases that mean the model gave up or produced filler. Anything matching is rejected (never saved).
const GENERIC_RE = /לא נמצא|אין מידע|אין נתונ|אין חדש|קשה להערי|מומלץ לעקוב|תלוי בשוק|לא ניתן לקבוע|אין לי גישה|כמודל שפה|כבינה מלאכותית|<ההסבר|<ההערכה|בשורה האחרונה|לא נמצאה הערכה/
// Echoes of our own output-format labels — the model returned the template instead of an answer.
const TEMPLATE_RE = /^(ביטחון|סנטימנט|הסבר|הערכה):/m

const letters = (s, re) => (s.match(re) || []).length

/**
 * Validate an insight before it is saved/displayed.
 * Returns { ok: true } or { ok: false, reason } where reason ∈
 *   empty | too-short | too-long | not-hebrew | generic | template | wrong-name
 * `mustMention` (optional): the instrument name — at least the first word must appear, which
 * catches "talks about the wrong company" answers.
 */
export function validateInsight(text, { minLen = MIN_INSIGHT_LEN, maxLen = MAX_INSIGHT_LEN, mustMention = null } = {}) {
  const t = (text || '').trim()
  if (!t) return { ok: false, reason: 'empty' }
  if (t.length < minLen) return { ok: false, reason: 'too-short' }
  if (t.length > maxLen) return { ok: false, reason: 'too-long' }
  const he = letters(t, /[\u0590-\u05FF]/g)
  const en = letters(t, /[A-Za-z]/g)
  if (he < 40 || he < en * 3) return { ok: false, reason: 'not-hebrew' }
  if (GENERIC_RE.test(t)) return { ok: false, reason: 'generic' }
  if (TEMPLATE_RE.test(t)) return { ok: false, reason: 'template' }
  if (mustMention) {
    // Soft check (Hebrew names vary in prefixes, e.g. "הפועלים"/"פועלים") — surfaced as a warning
    // for the logs, not a rejection.
    const stem = String(mustMention).replace(/^(מדד|מניית|קרן סל|בנק)\s+/, '').split(/\s+/)[0]?.replace(/^ה/, '')
    if (stem && stem.length >= 2 && !t.includes(stem)) return { ok: true, warning: 'name-not-mentioned' }
  }
  return { ok: true }
}

// Checker/process meta-commentary ("not verified", "the draft", "in the article from…") — never user-facing text.
export const META_RE = /לא אומת|נפסל|הטיוטה|הבודק|בכתבה מה/

// The earlier price-path fallback (highs/lows, sharpest day, "no cause found") — superseded, re-researched.
export const LEGACY_TEXT_RE = /הנקודה הגבוהה|והנמוכה ב-|התנועה היומית החדה|כותרות מהתקופה|לא נמצאה בחדשות סיבה|— כלומר תנועה ייחודית|חלק מהתנועה תואם את|התנועה קטנה ביחס לשוק/

/**
 * One-line JSON log so failures are greppable by ticker / period / stage in GitHub-Actions and
 * Cloudflare logs (instead of `catch {}`). Returns the record so callers can collect it.
 */
export function logEvent(level, fields) {
  const rec = { ts: new Date().toISOString(), level, ...fields }
  const line = JSON.stringify(rec)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  return rec
}
