// Plain-language explanation of a move built only from measured data and dated headlines, published
// whenever no AI text survives the fact-check. It says what moved the instrument as far as the
// numbers show — its sector, the whole market, or the stock on its own — and quotes the most
// relevant headline of the period, without inventing a cause. Pure — shared by the worker and the
// frontend.

const PERIOD_HE = { day: 'היום', week: 'בשבוע האחרון', month: 'בחודש האחרון' }
const SCOPE_HE = { day: 'היום', week: 'השבוע', month: 'החודש' }
const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`
const abs = (n) => `${Math.abs(n).toFixed(2)}%`
const noun = (n) => (n >= 0 ? 'עלייה' : 'ירידה')
// Hebrew one-letter preposition before a label: "ל-S&P 500", "לחוזים" (drops the article ה), "למדד".
const pre = (p, label) => (/^[A-Za-z0-9^]/.test(label) ? `${p}-${label}` : label.startsWith('ה') ? `${p}${label.slice(1)}` : `${p}${label}`)
const US_REF_RE = /וול סטריט|S&P|נאסד"ק|דאו|חוזים/

/** "מניית X" for a company, the index name for an index; generic subjects are kept as given. */
export function subjectHe(name, isIndex = false) {
  const n = String(name || '').trim() || (isIndex ? 'המדד' : 'המניה')
  if (/^ה?(מדד|נייר|מניה|קרן)|^מניית/.test(n)) return n
  return isIndex ? `מדד ${n}` : `מניית ${n}`
}

const isMasc = (s) => /^ה?(מדד|נייר)/.test(s)

/**
 * Hebrew explanation, or null when `changePct` is unknown.
 * facts: [{ symbol, label, changePct, role?, group? }] same-period benchmark moves (role 'sector' =
 * the instrument's sector benchmark); diagnosis: diagnoseMove() result; articles: [{ title, source,
 * kind? }] dated headlines from the same period, geopolitics already filtered out by the caller.
 */
export function measuredAnalysis({ subject, isIndex = false, market = null, changePct, period = 'day', periodHe, facts = [], diagnosis = null, articles = [] }) {
  if (changePct == null || !Number.isFinite(changePct)) return null
  const s = subjectHe(subject, isIndex)
  const masc = isMasc(s)
  const verb = masc ? (changePct >= 0 ? 'עלה' : 'ירד') : (changePct >= 0 ? 'עלתה' : 'ירדה')
  const self = masc ? 'המדד' : 'המניה'
  const when = periodHe || PERIOD_HE[period] || 'היום'
  const scope = SCOPE_HE[period] || 'היום'
  const up = changePct >= 0
  const ref = diagnosis?.ref
  const mkt = diagnosis?.market && diagnosis.market !== ref ? diagnosis.market : null
  const sector = facts.find((f) => f.role === 'sector' && Number.isFinite(f.changePct))
  const head = `${s} ${verb} ${abs(changePct)} ${when}`
  const parts = []
  let prefer = ['official', 'company', 'research', 'sector', 'wrap']

  switch (diagnosis?.kind) {
    case 'sector-wide': {
      const group = ref.group || 'שאר מניות הענף'
      parts.push(`${head} יחד עם ${group}: ${pre('ב', ref.label)} נרשמה ${noun(ref.changePct)} של ${abs(ref.changePct)}.`)
      parts.push(`כלומר המשקיעים ${up ? 'קנו' : 'מכרו'} ${scope} את ${group} באופן כללי, ו${self} ${masc ? 'נע' : 'נעה'} יחד עם הענף${mkt ? ` (לשם השוואה, ${mkt.label}: ${signed(mkt.changePct)})` : ''}.`)
      prefer = ['sector', 'official', 'company', 'research', 'wrap']
      break
    }
    case 'market-wide': {
      const il = market ? market === 'IL' : facts.some((f) => f.symbol === 'TA35.TA')
      if (il && US_REF_RE.test(ref.label)) {
        parts.push(`${head} בעקבות וול סטריט: ${pre('ב', ref.label)} נרשמה ${noun(ref.changePct)} של ${abs(ref.changePct)}.`)
        parts.push(`כלומר המשקיעים בתל אביב הגיבו למה שקרה בשווקים בארה"ב, והתנועה היא של השוק כולו${sector ? ` (${sector.label}: ${signed(sector.changePct)})` : ''}.`)
      } else {
        parts.push(`${head} יחד עם ${il ? 'כל הבורסה בתל אביב' : 'כל וול סטריט'}: ${pre('ב', ref.label)} נרשמה ${noun(ref.changePct)} של ${abs(ref.changePct)}.`)
        parts.push(`כלומר ${self} ${masc ? 'נע' : 'נעה'} עם השוק כולו${sector ? ` (${sector.label}: ${signed(sector.changePct)})` : ''}.`)
      }
      prefer = ['wrap', 'official', 'company', 'research', 'sector']
      break
    }
    case 'specific': {
      const against = Math.sign(ref.changePct) !== Math.sign(changePct)
      const cmp = [ref, sector].filter(Boolean).map((f) => `${f.label}: ${signed(f.changePct)}`).join(', ')
      parts.push(`${head}, ${against ? 'בניגוד לשוק' : 'הרבה יותר מהשוק'} (${cmp}).`)
      parts.push(`כלומר ${scope} המשקיעים ${up ? 'קנו' : 'מכרו'} דווקא את ${s}, והתנועה לא הגיעה מהשוק הרחב.`)
      break
    }
    case 'mixed':
      parts.push(`${head}. חלק מהתנועה הגיע מהשוק הרחב (${ref.label}: ${signed(ref.changePct)}), והשאר ייחודי ${pre('ל', self)}.`)
      break
    default:
      parts.push(`${head}.`)
  }

  const rank = (a) => { if (a.kind === 'daily') return -1; const i = prefer.indexOf(a.kind || 'company'); return i < 0 ? prefer.length : i }
  const best = articles.filter((a) => a?.title).sort((a, b) => rank(a) - rank(b))[0]
  if (best?.kind === 'daily' && best.summary) {
    const [, mm, dd] = best.date.split('-')
    const most = Math.sign(best.pct) === Math.sign(changePct) && Math.abs(best.pct) >= Math.abs(changePct) / 2
    parts.push(`${most ? 'רוב התנועה הגיעה' : 'היום הבולט בתקופה היה'} ב-${dd}.${mm} (${signed(best.pct)}): ${best.summary}${best.source ? ` (${best.source})` : ''}.`)
  } else if (best) {
    const lead = { sector: `כותרת בולטת על הענף ${scope}`, wrap: `מסיכום המסחר ${scope}` }[best.kind] || `הידיעה הבולטת על ${masc ? 'המדד' : 'החברה'} ${scope}`
    parts.push(`${lead}: "${best.title}"${best.source ? ` (${best.source})` : ''}.`)
  }
  return parts.join(' ')
}
