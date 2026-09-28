// Deterministic analysis of a move built only from measured data: the move itself, the same-period
// benchmark moves, the path (range / peak / trough / biggest day) and the period's headlines as
// context. Published whenever no AI text survives the fact-check, so every significant move gets a
// concrete description without inventing a cause. Pure — shared by the worker and the frontend.

const PERIOD_HE = { day: 'היום', week: 'בשבוע האחרון', month: 'בחודש האחרון' }
const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`
const fmtParts = (t, tz, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(new Date(t))
const ddmm = (t, tz) => fmtParts(t, tz, { day: '2-digit', month: '2-digit' }).replace('/', '.')
const hhmm = (t, tz) => fmtParts(t, tz, { hour: '2-digit', minute: '2-digit', hour12: false })
const dayKey = (t, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(t))

/**
 * Path of the price over the window, in % of the baseline (the close before the window). The
 * baseline defaults to the one implied by `changePct` and the last point, so the numbers always
 * agree with the headline change. Returns null when the series is too short to say anything.
 */
export function seriesPath({ series = [], base = null, changePct = null, period = 'day', tz = 'Asia/Jerusalem' }) {
  const pts = (series || []).filter((p) => p && Number.isFinite(p.v) && Number.isFinite(p.t))
  if (pts.length < 2) return null
  const last = pts.at(-1).v
  const b = base > 0 ? base : changePct != null && Number.isFinite(changePct) ? last / (1 + changePct / 100) : pts[0].v
  if (!(b > 0)) return null
  const rel = (v) => ((v - b) / b) * 100
  let hi = pts[0]
  let lo = pts[0]
  for (const p of pts) {
    if (p.v > hi.v) hi = p
    if (p.v < lo.v) lo = p
  }
  const out = { high: { t: hi.t, pct: rel(hi.v) }, low: { t: lo.t, pct: rel(lo.v) }, bigDay: null }
  if (period !== 'day') {
    const closes = new Map()
    for (const p of pts) closes.set(dayKey(p.t, tz), p)
    let prev = b
    for (const p of closes.values()) {
      const d = ((p.v - prev) / prev) * 100
      if (!out.bigDay || Math.abs(d) > Math.abs(out.bigDay.pct)) out.bigDay = { t: p.t, pct: d }
      prev = p.v
    }
  }
  return out
}

/**
 * Hebrew analysis text, or null when `changePct` is unknown.
 * facts: [{ label, changePct }] same-period benchmark moves; diagnosis: diagnoseMove() result;
 * articles: [{ title, source }] dated headlines from the same period (shown as context, not cause).
 */
export function measuredAnalysis({ subject, isIndex = false, changePct, period = 'day', periodHe, facts = [], diagnosis = null, series = [], base = null, tz = 'Asia/Jerusalem', articles = [] }) {
  if (changePct == null || !Number.isFinite(changePct)) return null
  const name = subject || 'הנייר'
  const masc = isIndex || /^(מדד|הנייר)/.test(name)
  const verb = masc ? (changePct >= 0 ? 'עלה' : 'ירד') : (changePct >= 0 ? 'עלתה' : 'ירדה')
  const when = periodHe || PERIOD_HE[period] || 'היום'
  const parts = [`${name} ${verb} ${Math.abs(changePct).toFixed(2)}% ${when}.`]

  const ref = diagnosis?.ref
  const peers = facts.filter((f) => Number.isFinite(f.changePct)).slice(0, 4)
  if (peers.length) {
    const scope = period === 'day' ? 'באותו יום' : 'באותה תקופה'
    const verdict = {
      'market-wide': ref && `בדומה ל${ref.label} (${signed(ref.changePct)}) — כלומר תנועה רוחבית של השוק`,
      specific: ref && `לעומת ${ref.label} (${signed(ref.changePct)}) — כלומר תנועה ייחודית לנייר, שאינה משקפת את השוק`,
      mixed: ref && `חלק מהתנועה תואם את ${ref.label} (${signed(ref.changePct)})`,
      flat: 'התנועה קטנה ביחס לשוק',
    }[diagnosis?.kind]
    parts.push(`${scope}: ${peers.map((f) => `${f.label} ${signed(f.changePct)}`).join(', ')}${verdict ? `; ${verdict}` : ''}.`)
  }

  const path = seriesPath({ series, base, changePct, period, tz })
  if (path) {
    const at = period === 'day' ? (t) => hhmm(t, tz) : (t) => ddmm(t, tz)
    const ref0 = period === 'day' ? 'ביחס לסגירה הקודמת' : 'ביחס לתחילת התקופה'
    let s = `הנקודה הגבוהה נרשמה ב-${at(path.high.t)} (${signed(path.high.pct)}) והנמוכה ב-${at(path.low.t)} (${signed(path.low.pct)}) ${ref0}`
    if (path.bigDay && Math.abs(path.bigDay.pct) >= 0.5) s += `; התנועה היומית החדה ביותר הייתה ב-${ddmm(path.bigDay.t, tz)} (${signed(path.bigDay.pct)})`
    parts.push(`${s}.`)
  }

  const heads = articles.filter((a) => a?.title).slice(0, 2)
  if (heads.length) parts.push(`כותרות מהתקופה (כהקשר, לא כסיבה מאומתת): ${heads.map((a) => `"${a.title}"${a.source ? ` (${a.source})` : ''}`).join('; ')}.`)
  else if (diagnosis?.kind !== 'market-wide') parts.push('לא נמצאה בחדשות סיבה ספציפית מאומתת לתנועה.')
  return parts.join(' ')
}
