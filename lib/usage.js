// Free-tier usage monitor. Our own scripts self-count the operations they perform into a daily
// Firestore doc (usage/{YYYY-MM-DD}); the 09:00 report compares them to the free-tier limits.
// This tracks what WE control server-side (Firestore writes, Gemini calls, emails) accurately;
// Firestore reads are dominated by the browser dashboard and are shown as a rough estimate.
import { FieldValue } from 'firebase-admin/firestore'

// key → { limit (per day), label, note, approx }
export const FREE_LIMITS = {
  firestoreWrites: { limit: 20000, label: 'Firestore — כתיבות', per: 'יום' },
  geminiCalls: { limit: 250, label: 'Gemini — קריאות AI', per: 'יום', approx: true },
  emailsSent: { limit: 100, label: 'Resend — מיילים', per: 'יום' },
}

export async function bumpUsage(db, dateStr, deltas) {
  const inc = {}
  for (const [k, v] of Object.entries(deltas)) if (v) inc[k] = FieldValue.increment(v)
  if (Object.keys(inc).length) await db.collection('usage').doc(dateStr).set(inc, { merge: true })
}

const barColor = (pct) => (pct >= 100 ? '#e5484d' : pct >= 70 ? '#d29922' : '#26a269')
const statusIcon = (pct) => (pct >= 100 ? '🔴' : pct >= 70 ? '⚠️' : '✅')

function row(label, used, limit, per, approx) {
  const pct = limit ? Math.min(999, Math.round((used / limit) * 100)) : 0
  const color = barColor(pct)
  return `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;">${label}${approx ? ' <span style="color:#8b949e;font-size:11px;">(מכסה משוערת)</span>' : ''}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;direction:ltr;text-align:left;">${used.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')} <span style="color:#8b949e;">/${per}</span></td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;">
        <div style="background:#eaeef2;border-radius:6px;height:8px;width:120px;overflow:hidden;">
          <div style="background:${color};height:8px;width:${Math.min(100, pct)}%;"></div>
        </div>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;direction:ltr;text-align:left;font-weight:700;color:${color};">${statusIcon(pct)} ${pct}%</td>
    </tr>`
}

export function buildUsageHtml({ dateStr, refLabel, usage = {} }) {
  const rows = Object.entries(FREE_LIMITS)
    .map(([k, m]) => row(m.label, usage[k] || 0, m.limit, m.per, m.approx))
    .join('')

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head>
  <body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#24292f;">
    <div dir="rtl" style="max-width:600px;margin:0 auto;padding:24px 20px;text-align:right;direction:rtl;">
      <h1 style="font-size:22px;margin:0 0 2px;">📊 מוניטור מכסות — KalStocks</h1>
      <div style="color:#6a737d;font-size:13px;margin-bottom:4px;">${dateStr}</div>
      <div style="color:#6a737d;font-size:13px;margin-bottom:18px;">צריכת השירותים החינמיים ${refLabel} מול הגבולות היומיים.</div>

      <table dir="rtl" style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="text-align:right;color:#6a737d;font-size:12px;">
          <th style="padding:6px 10px;">שירות</th><th style="padding:6px 10px;">ניצול</th><th style="padding:6px 10px;"></th><th style="padding:6px 10px;">%</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="margin-top:16px;font-size:13px;color:#24292f;line-height:1.7;">
        <b>שירותים ללא סיכון:</b><br>
        • GitHub Actions (poller + מיילים) — <b>ללא הגבלה</b> (repo ציבורי).<br>
        • Firebase Hosting — שימוש זניח מול המכסה (אחסון/תעבורה).<br>
        • Firestore קריאות — נשלטות ע"י הדשבורד; בפועל אלפים בודדים ליום מול מכסה של 50,000.
      </div>

      <p style="color:#8b949e;font-size:11px;margin-top:20px;line-height:1.6;">
        הנתונים נספרים אוטומטית ע"י המערכת. מכסת Gemini משוערת (משתנה לפי מודל/תוכנית). 🟢 עד 70% · 🟡 70–100% · 🔴 חריגה.
      </p>
    </div>
  </body></html>`
}
