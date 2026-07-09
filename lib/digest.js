// Phase 6 — twice-daily email digest. Pure HTML builder (RTL Hebrew), so it's unit-testable
// without Firestore or Resend. scripts/digest.mjs feeds it data and sends via Resend.
import { badgeHtml } from './logos.js'

const UP = '#26a269'
const DOWN = '#e5484d'

const fmt = (n) =>
  (n ?? 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const pctText = (c) => `${c >= 0 ? '▲' : '▼'} ${Math.abs(c ?? 0).toFixed(2)}%`

export function buildDigestHtml({ dateStr, timeLabel, movers = [], all = [] }) {
  const moversHtml = movers.length
    ? movers
        .map((m) => {
          const color = m.direction === 'up' ? UP : DOWN
          const sources = (m.sources || []).length ? `מקורות: ${m.sources.join(', ')}` : ''
          return `
      <div dir="rtl" style="background:#f6f8fa;border:1px solid #e6e9ee;border-radius:10px;padding:14px 16px;margin:10px 0;text-align:right;">
        <div style="font-size:16px;font-weight:700;">
          ${badgeHtml(m.symbol, m.nameHe, { kind: m.kind })}${m.nameHe} <span style="color:${color};direction:ltr;">${pctText(m.changePct)}</span>
        </div>
        <div style="font-size:14px;line-height:1.6;color:#24292f;margin-top:6px;">${m.explanation || ''}</div>
        <div style="font-size:12px;color:#6a737d;margin-top:6px;">ביטחון: ${m.confidence || '—'}${sources ? ' · ' + sources : ''}</div>
      </div>`
        })
        .join('')
    : `<p style="color:#6a737d;">לא זוהו תנודות חריגות היום מעבר לספים שהגדרת.</p>`

  const rows = all
    .slice()
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))
    .map((s) => {
      const color = (s.changePct ?? 0) >= 0 ? UP : DOWN
      const price = s.isIndex ? fmt(s.priceIls) : `₪${fmt(s.priceIls)}`
      return `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${badgeHtml(s.symbol, s.nameHe, { kind: s.kind, isIndex: s.isIndex }, 16)}${s.nameHe}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;direction:ltr;text-align:left;">${price}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;direction:ltr;text-align:left;color:${color};font-weight:600;">${pctText(s.changePct)}</td>
      </tr>`
    })
    .join('')

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head>
  <body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#24292f;">
    <div dir="rtl" style="max-width:600px;margin:0 auto;padding:24px 20px;text-align:right;direction:rtl;">
      <h1 style="font-size:22px;margin:0 0 2px;">StocksInsights — סיכום ${timeLabel || ''}</h1>
      <div style="color:#6a737d;font-size:13px;margin-bottom:18px;">${dateStr}</div>

      <h2 style="font-size:17px;border-bottom:2px solid #eee;padding-bottom:6px;">מגמות משמעותיות והסבר</h2>
      ${moversHtml}

      <h2 style="font-size:17px;border-bottom:2px solid #eee;padding-bottom:6px;margin-top:24px;">כל הניירות במעקב</h2>
      <table dir="rtl" style="width:100%;border-collapse:collapse;font-size:14px;">
        <tbody>${rows || '<tr><td style="color:#6a737d;padding:8px 0;">אין ניירות במעקב.</td></tr>'}</tbody>
      </table>

      <p style="color:#8b949e;font-size:11px;margin-top:22px;line-height:1.6;">
        נתונים לצורכי מידע בלבד — אינם מהווים ייעוץ השקעות. המחירים מתעדכנים באיחור של כ־15 דקות.
        ההסברים מבוססים על חדשות זמינות ועשויים לכלול אי־דיוקים.
      </p>
    </div>
  </body></html>`
}
