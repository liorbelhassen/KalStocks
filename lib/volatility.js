import { LEGACY_TEXT_RE } from './validate.js'

// Volatility classification (Phase 3). Pure function so it's easy to unit-test.
//
// A move is "significant" when either:
//   - the day change vs previous close crosses the user's threshold, OR
//   - the intraday swing (peak-to-trough of today's series) is large — this catches the
//     choppy "+5% then -4% then +7%" pattern the user cares about, even if the net day change
//     ends up small.
// `band` = how many threshold-steps the day move spans (0,1,2…); used to re-flag for a fresh
// explanation only when a move materially grows, instead of on every 15-min poll.
export function classify(snap, thresholdPct = 0.5) {
  const change = snap?.changePct ?? 0
  const vals = (snap?.series || []).map((p) => p.v).filter((v) => v != null)

  let swingPct = 0
  if (vals.length > 1) {
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    swingPct = min > 0 ? ((max - min) / min) * 100 : 0
  }

  const bigDay = Math.abs(change) >= thresholdPct
  const bigSwing = swingPct >= thresholdPct * 2
  const significant = bigDay || bigSwing

  return {
    change,
    swingPct,
    significant,
    band: Math.floor(Math.abs(change) / thresholdPct),
    direction: change >= 0 ? 'up' : 'down',
    reason: bigDay ? 'daily-move' : bigSwing ? 'intraday-swing' : null,
  }
}

// Dedup level for "already explained today": any significant move is at least level 1, so an
// intraday-swing-only move (day band 0) is still explained once.
export const triggerBand = (c) => (c.significant ? Math.max(c.band, 1) : 0)

// A stored day brief no longer describes the current move: the direction flipped or the move
// changed by at least half (min 0.5 points). A trigger brief without `explainedPct` is from before
// it was recorded, so its move is unknown.
export function briefOutdated(brief, changePct) {
  if (brief && LEGACY_TEXT_RE.test(brief.assessment || '')) return true
  if (!brief || changePct == null || !Number.isFinite(changePct)) return false
  const e = brief.explainedPct
  if (e == null) return brief.band != null
  if (Math.abs(changePct) < 0.5 && Math.abs(e) < 0.5) return false
  return Math.sign(e) !== Math.sign(changePct) || Math.abs(changePct - e) >= Math.max(0.5, Math.abs(e) * 0.5)
}

// A fact-checked brief for the same move beats a numbers-only fallback from a later retry.
export const keepCheckedBrief = (existing, next, changePct) =>
  next?.verdict === 'נתונים בלבד' && !!existing?.assessment && !!existing.verdict &&
  existing.verdict !== 'נתונים בלבד' && !briefOutdated(existing, changePct)
