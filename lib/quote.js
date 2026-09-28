// TASE securities are quoted in agorot (ILA) — that's how Google/TASE show them (e.g. 3,527).
// Snapshots store ₪ (`priceIls` = agorot ÷ 100) so holding values stay in shekels; these helpers
// convert back for display only. Indices are points, not agorot.
export const AGOROT_LABEL = 'אג׳'

export const quotedInAgorot = (snap) => snap?.currency === 'ILA' && !snap?.isIndex

export const quotePrice = (priceIls, agorot) => (priceIls == null ? null : agorot ? priceIls * 100 : priceIls)
