// Company logos via Google's favicon service (free, reliable, works in email — returns a
// generic icon rather than a broken image for unknown domains). Indices/ETFs have no company
// logo. Shared by the dashboard (src) and the email builders (lib).
export const LOGO_DOMAINS = {
  'POLI.TA': 'bankhapoalim.co.il',
  'LUMI.TA': 'leumi.co.il',
  'MZTF.TA': 'mizrahi-tefahot.co.il',
  'DSCT.TA': 'discountbank.co.il',
  'FIBI.TA': 'fibi.co.il',
  'TEVA.TA': 'tevapharm.com',
  'NICE.TA': 'nice.com',
  'ESLT.TA': 'elbitsystems.com',
  'ICL.TA': 'icl-group.com',
  'BEZQ.TA': 'bezeq.co.il',
  'TSEM.TA': 'towersemi.com',
  'NVMI.TA': 'nova.com',
  'ENOG.TA': 'energean.com',
  'AZRG.TA': 'azrieli.com',
}

export function logoUrl(symbol, size = 64) {
  const domain = LOGO_DOMAINS[symbol]
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}` : null
}
