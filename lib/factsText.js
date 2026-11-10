// Deterministic, data-only summaries shown when no fact-checked AI analysis exists yet. They are built
// solely from measured numbers (change, window dates, in-period range, reference index) and are labelled
// in the UI as "data", never as an insight — so nothing here may claim a cause.

const pct = (n) => `${Math.abs(n).toFixed(2)}%`
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '')

function rangeOf(series) {
  const ys = (series || []).map((p) => p?.v ?? p?.price ?? p?.c).filter((v) => Number.isFinite(v) && v > 0)
  if (ys.length < 2) return null
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const last = ys.at(-1)
  return { lo, hi, last, spanPct: ((hi - lo) / lo) * 100, offHighPct: ((last - hi) / hi) * 100, offLowPct: ((last - lo) / lo) * 100 }
}

function vsBenchmark(changePct, bench, subject) {
  if (!bench || bench.changePct == null) return ''
  const b = bench.changePct
  const diff = changePct - b
  const bVerb = b >= 0 ? 'עלייה' : 'ירידה'
  let rel
  if (Math.abs(diff) < 0.5) rel = `${subject} נע בקו אחד עם השוק`
  else if (Math.sign(changePct) !== Math.sign(b) && Math.abs(b) >= 0.3) rel = `${subject} נע בכיוון הפוך לשוק (פער של ${diff.toFixed(2)} נק' אחוז)`
  else rel = `${subject} ${diff > 0 ? 'חזק' : 'חלש'} מהשוק ב-${Math.abs(diff).toFixed(2)} נק' אחוז`
  return ` באותה תקופה נרשמה ${bVerb} של ${pct(b)} ב${bench.label} — ${rel}.`
}

function rangeText(r) {
  if (!r || r.spanPct < 0.2) return ''
  const pos = Math.abs(r.offHighPct) < 0.3 ? 'קרוב לשיא התקופה' : Math.abs(r.offLowPct) < 0.3 ? 'קרוב לשפל התקופה' : `${pct(r.offHighPct)} מתחת לשיא התקופה`
  return ` טווח התנודה בתקופה: ${pct(r.spanPct)} בין השפל לשיא, והמחיר האחרון ${pos}.`
}

/** Data-only text for a week/month entry `p` ({ changePct, startDate, endDate, series, benchmark }). */
export function periodFactsText(p, period, { isIndex = false } = {}) {
  if (p?.changePct == null) return null
  const subject = isIndex ? 'המדד' : 'הנייר'
  const c = p.changePct
  const periodHe = period === 'week' ? 'בשבוע' : 'בחודש'
  const dates = p.startDate && p.endDate ? ` (${dmy(p.startDate)}–${dmy(p.endDate)})` : ''
  const move = Math.abs(c) < 0.05 ? `${subject} סיים ללא שינוי ${periodHe}${dates}.` : `${subject} ${c >= 0 ? 'עלה' : 'ירד'} ${pct(c)} ${periodHe}${dates}.`
  return `${move}${vsBenchmark(c, p.benchmark, subject)}${rangeText(rangeOf(p.series))}`.trim()
}

/** Data-only text for today's snapshot, optionally vs a reference index snapshot `bench` ({ label, changePct }). */
export function dayFactsText(snap, { bench = null } = {}) {
  const c = snap?.changePct
  if (c == null) return null
  const isIdx = !!snap.isIndex
  const subject = isIdx ? 'המדד' : 'הנייר'
  const move = Math.abs(c) < 0.05 ? `${subject} נסחר היום ללא שינוי.` : `${subject} ${c >= 0 ? 'עלה' : 'ירד'} היום ${pct(c)}.`
  return `${move}${vsBenchmark(c, bench, subject).replace('באותה תקופה', 'במקביל')}${rangeText(rangeOf(snap.series)).replace('בתקופה', 'היום').replace('התקופה', 'היום')}`.trim()
}
