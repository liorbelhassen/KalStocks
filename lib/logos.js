// Instrument badges. No reliable free brand-logo API exists for Israeli equities (Clearbit's
// free API was shut down; Google favicons return a gray globe for many). So to GUARANTEE every
// item shows a real badge (never a gray globe):
//   - indices / ETFs → the country flag (all TASE here → Israel 🇮🇱)
//   - equities        → a colored monogram (deterministic color + the name's first letter)
// Shared by the dashboard (src) and the email builders (lib). Works in email (pure HTML).
const FLAG_IL = '🇮🇱'

export function badgeFor(symbol, nameHe, { kind, isIndex } = {}) {
  if (isIndex || kind === 'index' || kind === 'etf') {
    return { type: 'flag', char: FLAG_IL }
  }
  let h = 0
  for (let i = 0; i < (symbol || '').length; i++) h = (h * 31 + symbol.charCodeAt(i)) % 360
  return { type: 'mono', char: (nameHe || symbol || '?').trim().charAt(0) || '?', color: `hsl(${h}, 52%, 42%)` }
}

// Inline HTML badge for emails (no JS / external images).
export function badgeHtml(symbol, nameHe, opts, size = 18) {
  const b = badgeFor(symbol, nameHe, opts)
  if (b.type === 'flag') {
    return `<span style="font-size:${size}px;vertical-align:middle;margin-left:6px;">${b.char}</span>`
  }
  return `<span style="display:inline-block;width:${size}px;height:${size}px;line-height:${size}px;text-align:center;border-radius:5px;background:${b.color};color:#fff;font-size:${Math.round(size * 0.6)}px;font-weight:700;vertical-align:middle;margin-left:6px;">${b.char}</span>`
}
