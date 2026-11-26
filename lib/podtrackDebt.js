// Read-only "owed to Lior" ledger from the public PodTrack Google Sheet (tab "הוצאות").
// The total is the sum of every numeric value in column H; rows with an H value are listed.
export const SHEET_ID = '1-1DAHzfF8sz3M_HChFw8JO_UlhVs-5BsU1pj4h2nHLA'
export const SHEET_TAB = 'הוצאות'

export function sheetUrl(now = Date.now()) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_TAB)}&_=${now}`
}

const toNumber = (cell) => {
  const v = cell?.v
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const n = Number(v.replace(/[₪,\s]/g, '').replace(/^(-?)-?/, '$1'))
  return v.trim() && Number.isFinite(n) ? n : null
}

const text = (cell) => (cell?.f ?? cell?.v ?? '').toString().trim()

// gviz wraps the JSON in `google.visualization.Query.setResponse(...)`.
export function parseGviz(body) {
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('תגובה לא צפויה מהגיליון')
  const data = JSON.parse(body.slice(start, end + 1))
  if (data.status === 'error') throw new Error(data.errors?.[0]?.detailed_message || data.errors?.[0]?.message || 'שגיאה בקריאת הגיליון')
  if (!data.table) throw new Error('הגיליון ריק')
  return data.table
}

export function summarizeDebt(table) {
  const col = (id) => table.cols.findIndex((c) => c.id === id)
  const [A, B, E, F, G, H] = ['A', 'B', 'E', 'F', 'G', 'H'].map(col)
  if (H < 0) throw new Error('עמודה H לא נמצאה בגיליון')
  const rows = []
  for (const r of table.rows || []) {
    const c = r.c || []
    const amount = toNumber(c[H])
    if (amount == null) continue
    rows.push({ item: text(c[A]), details: text(c[B]), date: text(c[E]), notes: text(c[F]), status: text(c[G]), amount })
  }
  const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
  return { total, rows, label: table.cols[H].label?.trim() || '' }
}
