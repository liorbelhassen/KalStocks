// Volatility classification (Phase 3). Pure function so it's easy to unit-test.
//
// A move is "significant" when either:
//   - the day change vs previous close crosses the user's threshold, OR
//   - the intraday swing (peak-to-trough of today's series) is large — this catches the
//     choppy "+5% then -4% then +7%" pattern the user cares about, even if the net day change
//     ends up small.
// `band` = how many threshold-steps the day move spans (0,1,2…); used to re-flag for a fresh
// explanation only when a move materially grows, instead of on every 15-min poll.
export function classify(snap, thresholdPct = 3) {
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
