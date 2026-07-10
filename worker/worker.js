// StocksInsights Worker. Two actions:
//  - vision: a portfolio screenshot → Gemini Vision → detected holdings (Gemini key server-side).
//  - quote:  fetch a live Yahoo snapshot for a symbol (so a manually-added stock loads instantly,
//            without waiting for the scheduled poller — no Gemini involved).
import { fetchSnapshot, fetchSnapshots } from '../lib/yahoo.js'
import { getAccessToken, listDocs, patchDoc } from './firestore.js'
import { assessOpen, buildMorningHtml } from '../lib/morning.js'
import { explainMove } from '../lib/explain.js'
import { visionExtract } from '../lib/vision.js'
import { askWithSearch } from '../lib/llm.js'
import { classify } from '../lib/volatility.js'
import { telegramContext } from '../lib/telegram.js'

const ALLOWED = ['https://kalstocks1.web.app', 'http://localhost:5175', 'http://localhost:5173']

// Open if TASE (Israel, Sun–Thu) OR US markets (New York, Mon–Fri) are trading. DST-safe via Intl.
function minutesInZone(tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  return { wd: p.find((x) => x.type === 'weekday').value, min: +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value }
}
function marketOpen() {
  const il = minutesInZone('Asia/Jerusalem')
  const taseOpen = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(il.wd) && il.min >= 570 && il.min <= 1040 // TASE trades Mon–Fri
  const ny = minutesInZone('America/New_York')
  const usOpen = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(ny.wd) && ny.min >= 570 && ny.min < 960
  return taseOpen || usOpen
}

// Reliable 5-min price poll (Cloudflare cron). Writes snapshots to Firestore via REST.
async function pollPrices(env) {
  if (!env.SERVICE_ACCOUNT) return
  if (!marketOpen()) return
  const sa = JSON.parse(env.SERVICE_ACCOUNT)
  const token = await getAccessToken(sa)
  const wl = await listDocs(token, sa.project_id, 'watchlist')
  const symbols = new Set(['TA35.TA'])
  wl.forEach((w) => {
    if (w.kind === 'other') return // manual-price stocks aren't on Yahoo
    const p = w.priceSymbol || w.symbol
    if (p) symbols.add(p)
  })
  const snaps = await fetchSnapshots([...symbols])
  const byPrice = {}
  for (const snap of snaps) {
    if (snap.error) continue
    byPrice[snap.symbol] = snap
    try {
      await patchDoc(token, sa.project_id, `snapshots/${encodeURIComponent(snap.symbol)}`, {
        ...snap,
        updatedAt: Date.now(),
      })
    } catch {
      /* skip one symbol on failure */
    }
  }

  // Volatility trigger: when a stock crosses its per-stock threshold, refresh its insight with a
  // fresh, direction-aware explanation of the move. Deduped by 'band' so the same level isn't
  // re-explained every 5 minutes.
  if (!env.GEMINI_API_KEY && !env.OPENAI_API_KEY) return
  const dateStr = ilDateISO()
  const priorBand = {}
  ;(await listDocs(token, sa.project_id, 'briefs')).forEach((b) => { if (b.date === dateStr) priorBand[b.priceSymbol] = b.band || 0 })
  const keys = { geminiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL, openaiKey: env.OPENAI_API_KEY, openaiModel: env.OPENAI_MODEL }
  const session = Math.floor(minutesInZone('Asia/Jerusalem').min / 60) < 12 ? 'morning' : 'midday'
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const done = new Set()
  let news = null // fetched lazily on the first significant mover
  for (const w of wl) {
    if (w.kind === 'other') continue
    const ps = w.priceSymbol || w.symbol
    if (done.has(ps)) continue
    const snap = byPrice[ps]
    if (!snap) continue
    const c = classify(snap, w.thresholdPct || 3)
    if (!c.significant || (priorBand[ps] || 0) >= c.band) continue // not significant, or level already explained
    done.add(ps)
    try {
      if (news === null) news = await telegramContext() // fetch once, only if there's a mover to explain
      const isIndex = !!snap.isIndex
      const a = await assessOpen({ nameHe: w.nameHe, symbol: isIndex ? '' : ps, date: dateStr, isIndex, session, changePct: snap.changePct, newsContext: news }, keys)
      await patchDoc(token, sa.project_id, `briefs/${encodeURIComponent(`${ps}__${dateStr}`)}`, {
        priceSymbol: ps, date: dateStr, session, band: c.band, assessment: a.assessment, sentiment: a.sentiment, confidence: a.confidence, sources: a.sources || [], at: Date.now(),
      })
      await sleep(2000)
    } catch {
      /* skip one symbol */
    }
  }
}

const ilDateISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
const ilDateHe = () =>
  new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())

// Morning brief — reliable 09:00 Israel (Cloudflare cron fires on time). Sends the email +
// writes today's briefs + week/month period data & explanations. Reuses the shared libs.
async function morningJob(env) {
  if (!env.SERVICE_ACCOUNT || (!env.GEMINI_API_KEY && !env.OPENAI_API_KEY)) return
  const ilHour = Math.floor(minutesInZone('Asia/Jerusalem').min / 60)
  const session = ilHour === 9 ? 'morning' : ilHour === 13 ? 'midday' : null
  if (!session) return // only the 09:xx (morning brief + email) or 13:xx (midday refresh) slots — DST-safe

  // Gemini (free) first, OpenAI (paid) fallback — keeps assessments reliable past Gemini's quota.
  const keys = { geminiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL, openaiKey: env.OPENAI_API_KEY, openaiModel: env.OPENAI_MODEL }
  const news = await telegramContext() // real-time headlines to ground the insights (anti-hallucination)

  const sa = JSON.parse(env.SERVICE_ACCOUNT)
  const token = await getAccessToken(sa)
  const pid = sa.project_id
  const dateStr = ilDateISO()

  const items = await listDocs(token, pid, 'watchlist')
  const snaps = {}
  ;(await listDocs(token, pid, 'snapshots')).forEach((s) => {
    if (s.symbol) snaps[s.symbol] = s
  })

  // Digest goes only to DIGEST_TO for now → email only that user's own portfolio.
  // Shared AI/price data below is still computed over every user's symbols (the union).
  const users = await listDocs(token, pid, 'users')
  const digestUid = users.find((u) => u.email && u.email === env.DIGEST_TO)?.uid || null
  const emailSource = digestUid ? items.filter((w) => w.userId === digestUid) : items

  // 'other' (manual-price) stocks still get a news-based assessment by name — just no periods.
  const groups = new Map()
  for (const w of items) {
    const ps = w.priceSymbol || w.symbol
    if (!ps) continue
    const isOther = w.kind === 'other'
    if (!groups.has(ps)) groups.set(ps, { priceSymbol: ps, repName: w.nameHe, isIndex: snaps[ps]?.isIndex, isOther, symbol: isOther ? '' : ps })
    if (snaps[ps]?.isIndex) groups.get(ps).repName = w.nameHe
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const assessments = {}
  for (const g of groups.values()) {
    try {
      assessments[g.priceSymbol] = await assessOpen({ nameHe: g.repName, symbol: g.symbol, date: dateStr, isIndex: !!g.isIndex, session, changePct: session === 'midday' ? snaps[g.priceSymbol]?.changePct : null, newsContext: news }, keys)
    } catch {
      /* skip */
    }
    await sleep(4500) // pace to stay under Gemini's ~20 requests/minute free limit
  }
  for (const [ps, a] of Object.entries(assessments)) {
    await patchDoc(token, pid, `briefs/${encodeURIComponent(`${ps}__${dateStr}`)}`, {
      priceSymbol: ps, date: dateStr, session, assessment: a.assessment, sentiment: a.sentiment, confidence: a.confidence, sources: a.sources || [], at: Date.now(),
    })
  }

  // Midday only refreshes the dashboard insights (session-aware) — no email, no period recompute.
  if (session !== 'morning') { console.log('midday refresh done for', dateStr); return }

  const emailItems = emailSource
    .filter((w) => w.kind !== 'other')
    .map((w) => {
      const ps = w.priceSymbol || w.symbol
      const a = assessments[ps] || {}
      return { symbol: w.symbol, nameHe: w.nameHe, kind: w.kind, currency: (w.market || 'IL') === 'US' ? '$' : '₪', isIndex: snaps[ps]?.isIndex, priceIls: snaps[ps]?.priceIls, assessment: a.assessment || 'לא נמצאה הערכה.', sentiment: a.sentiment, confidence: a.confidence, sources: a.sources }
    })
  const html = buildMorningHtml({ dateStr: ilDateHe(), items: emailItems, session: 'morning' })
  if (env.RESEND_API_KEY && env.DIGEST_TO) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.DIGEST_FROM || 'StocksInsights <onboarding@resend.dev>', to: env.DIGEST_TO, subject: `☀️ סקירת בוקר StocksInsights · ${dateStr}`, html }),
    })
  }

  // Week/month period data + explanations.
  const pchg = (snap) => {
    const v = (snap.series || []).map((p) => p.v).filter((x) => x != null)
    return v.length > 1 ? ((v[v.length - 1] - v[0]) / v[0]) * 100 : 0
  }
  for (const [ps, g] of groups.entries()) {
    if (g.isOther) continue // no Yahoo price series for manual-price stocks
    try {
      const repName = g.repName || ps
      const wk = await fetchSnapshot(ps, { range: '5d', interval: '30m' })
      const mo = await fetchSnapshot(ps, { range: '1mo', interval: '1d' })
      const wc = pchg(wk)
      const mc = pchg(mo)
      const we = await explainMove({ nameHe: repName, symbol: ps, changePct: wc, direction: wc >= 0 ? 'up' : 'down', date: dateStr, period: 'week', newsContext: news }, keys).catch(() => null)
      await sleep(4500)
      const me = await explainMove({ nameHe: repName, symbol: ps, changePct: mc, direction: mc >= 0 ? 'up' : 'down', date: dateStr, period: 'month', newsContext: news }, keys).catch(() => null)
      await sleep(4500)
      await patchDoc(token, pid, `periods/${encodeURIComponent(ps)}`, {
        symbol: ps, updatedAt: Date.now(),
        week: { changePct: Math.round(wc * 100) / 100, series: wk.series || [], explanation: we?.explanation || null, confidence: we?.confidence || null, sources: we?.sources || [] },
        month: { changePct: Math.round(mc * 100) / 100, series: mo.series || [], explanation: me?.explanation || null, confidence: me?.confidence || null, sources: me?.sources || [] },
      })
    } catch {
      /* skip */
    }
  }
  console.log('morning job done for', dateStr)
}

// On-demand generation for a single instrument (when a user just added it) — today's brief +
// week/month periods, so the reviews appear within seconds instead of waiting for the morning cron.
async function primeSymbol(env, symbol, nameHe, isIndex) {
  const sa = JSON.parse(env.SERVICE_ACCOUNT)
  const token = await getAccessToken(sa)
  const pid = sa.project_id
  const dateStr = ilDateISO()
  const session = Math.floor(minutesInZone('Asia/Jerusalem').min / 60) < 12 ? 'morning' : 'midday'
  const keys = { geminiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL, openaiKey: env.OPENAI_API_KEY, openaiModel: env.OPENAI_MODEL }
  const news = await telegramContext() // ground the new stock's insight in real current headlines

  // Current-day change so the just-added stock's insight matches its actual direction.
  let changePct = null
  if (!symbol.startsWith('X-')) { try { changePct = (await fetchSnapshot(symbol)).changePct } catch { /* ignore */ } }

  try {
    const a = await assessOpen({ nameHe, symbol: isIndex ? '' : symbol, date: dateStr, isIndex, session, changePct, newsContext: news }, keys)
    await patchDoc(token, pid, `briefs/${encodeURIComponent(`${symbol}__${dateStr}`)}`, {
      priceSymbol: symbol, date: dateStr, session, assessment: a.assessment, sentiment: a.sentiment, confidence: a.confidence, sources: a.sources || [], at: Date.now(),
    })
  } catch (e) { console.log('prime brief error', String(e)) }

  if (symbol.startsWith('X-')) return // manual-price stocks have no Yahoo series
  try {
    const pchg = (snap) => { const v = (snap.series || []).map((p) => p.v).filter((x) => x != null); return v.length > 1 ? ((v[v.length - 1] - v[0]) / v[0]) * 100 : 0 }
    const wk = await fetchSnapshot(symbol, { range: '5d', interval: '30m' })
    const mo = await fetchSnapshot(symbol, { range: '1mo', interval: '1d' })
    const wc = pchg(wk), mc = pchg(mo)
    const we = await explainMove({ nameHe, symbol, changePct: wc, direction: wc >= 0 ? 'up' : 'down', date: dateStr, period: 'week', newsContext: news }, keys).catch(() => null)
    const me = await explainMove({ nameHe, symbol, changePct: mc, direction: mc >= 0 ? 'up' : 'down', date: dateStr, period: 'month', newsContext: news }, keys).catch(() => null)
    await patchDoc(token, pid, `periods/${encodeURIComponent(symbol)}`, {
      symbol, updatedAt: Date.now(),
      week: { changePct: Math.round(wc * 100) / 100, series: wk.series || [], explanation: we?.explanation || null, confidence: we?.confidence || null, sources: we?.sources || [] },
      month: { changePct: Math.round(mc * 100) / 100, series: mo.series || [], explanation: me?.explanation || null, confidence: me?.confidence || null, sources: me?.sources || [] },
    })
  } catch (e) { console.log('prime periods error', String(e)) }
}

function cors(origin) {
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}
const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } })

// Line format (NOT JSON) so Hebrew gershayim like ת"א don't break parsing.
const PROMPT = `זהו צילום מסך של תיק/רשימת מניות מאפליקציית מסחר (כנראה ישראלית).
זהה את ניירות הערך שמופיעים, ואם מוצגת כמות המניות המוחזקת מכל אחד — ציין אותה.
החזר כל אחזקה בשורה נפרדת בפורמט המדויק:  שם | כמות
(כמות = מספר, או ריק אם לא מוצג). בלי שום טקסט אחר, בלי כותרות.`

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || ''
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) })
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin)
    try {
      const body = await request.json()

      // Action: generate today/week/month reviews for a just-added instrument, in the background,
      // so they appear within seconds (no waiting for the morning cron).
      if (body.action === 'prime') {
        const { symbol, nameHe, isIndex } = body
        if (!symbol || !nameHe) return json({ error: 'missing symbol/name' }, 400, origin)
        if (!env.SERVICE_ACCOUNT || (!env.GEMINI_API_KEY && !env.OPENAI_API_KEY)) return json({ skipped: true }, 200, origin)
        ctx.waitUntil(primeSymbol(env, symbol, nameHe, !!isIndex).catch((e) => console.log('prime error:', String(e))))
        return json({ ok: true }, 200, origin)
      }

      // Action: resolve a (possibly Hebrew) instrument name to a real Yahoo ticker, so a stock
      // added by any user gets full price/chart/reviews — never a dead 'other' entry.
      if (body.action === 'resolve') {
        const name = (body.name || '').trim()
        if (!name) return json({ notFound: true }, 200, origin)
        // 1) Yahoo search (works for tickers + English names).
        try {
          const r = await fetch(
            `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=6&newsCount=0`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (StocksInsights)' } },
          )
          const d = await r.json()
          const hit = (d.quotes || []).find((x) => x.symbol && ['EQUITY', 'ETF', 'INDEX'].includes(x.quoteType))
          if (hit) return json({ symbol: hit.symbol, name: hit.shortname || hit.longname || hit.symbol, quoteType: hit.quoteType, via: 'search' }, 200, origin)
        } catch { /* fall through */ }
        // 2) LLM (web-grounded) name → ticker, verified against a live Yahoo quote.
        try {
          const keys = { geminiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL, openaiKey: env.OPENAI_API_KEY, openaiModel: env.OPENAI_MODEL }
          const { text } = await askWithSearch(
            `מהו הסימול המדויק ב-Yahoo Finance עבור נייר הערך "${name}"? אם הוא נסחר בבורסת תל אביב הוסף סיומת .TA (למשל BEZQ.TA, ALAR.TA); אם בארה"ב השתמש בסימול האמריקאי (למשל MU, AAPL). החזר אך ורק את הסימול עצמו, בלי טקסט נוסף. אם אינך יודע — החזר NONE.`,
            keys, { temperature: 0 },
          )
          const m = text.match(/\^?[A-Z]{2,6}(?:\.[A-Z]{1,3})?/)
          const ticker = m && m[0] !== 'NONE' ? m[0] : null
          if (ticker) {
            const snap = await fetchSnapshot(ticker)
            if (snap && snap.priceIls != null) {
              return json({ symbol: ticker, name, quoteType: snap.isIndex ? 'INDEX' : 'EQUITY', via: 'llm' }, 200, origin)
            }
          }
        } catch { /* fall through */ }
        return json({ notFound: true }, 200, origin)
      }

      // Action: search Yahoo by name/ticker — finds any stock, not just the catalog.
      if (body.action === 'search') {
        const q = (body.query || '').trim()
        if (q.length < 2) return json({ results: [] }, 200, origin)
        try {
          const r = await fetch(
            `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (StocksInsights)' } },
          )
          const d = await r.json()
          const results = (d.quotes || [])
            .filter((x) => x.symbol && ['EQUITY', 'ETF', 'INDEX'].includes(x.quoteType))
            .map((x) => ({
              symbol: x.symbol,
              name: x.shortname || x.longname || x.symbol,
              exchange: x.exchange || '',
              quoteType: x.quoteType,
            }))
          return json({ results }, 200, origin)
        } catch (e) {
          return json({ error: 'search failed', detail: String(e) }, 502, origin)
        }
      }

      // Action: live quote for a single symbol (instant load on manual add).
      if (body.action === 'quote') {
        if (!body.symbol) return json({ error: 'missing symbol' }, 400, origin)
        try {
          const snapshot = await fetchSnapshot(body.symbol)
          return json({ snapshot }, 200, origin)
        } catch (e) {
          return json({ error: 'quote failed', detail: String(e) }, 502, origin)
        }
      }

      const { imageBase64, mimeType } = body
      if (!imageBase64) return json({ error: 'missing image' }, 400, origin)

      // Gemini Vision first, OpenAI Vision fallback when Gemini's quota is out.
      let text
      try {
        const keys = { geminiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL, openaiKey: env.OPENAI_API_KEY, openaiModel: env.OPENAI_MODEL }
        ;({ text } = await visionExtract({ imageBase64, mimeType: mimeType || 'image/png', prompt: PROMPT }, keys))
      } catch (e) {
        return json({ error: 'vision failed', detail: String(e) }, 502, origin)
      }

      const holdings = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('|'))
        .map((line) => {
          const [name, qty] = line.split('|').map((s) => s.trim())
          const n = parseFloat((qty || '').replace(/[^\d.]/g, ''))
          return { name, quantity: Number.isFinite(n) ? n : null }
        })
        .filter((h) => h.name)

      return json({ holdings }, 200, origin)
    } catch (e) {
      return json({ error: String(e) }, 500, origin)
    }
  },

  // Cloudflare cron triggers (fire on time). */5 → price poll; 06:00/07:00 UTC → morning brief.
  async scheduled(event, env, ctx) {
    if (event.cron === '*/5 * * * *') {
      ctx.waitUntil(pollPrices(env).catch((e) => console.log('cron poll error:', String(e))))
    } else {
      ctx.waitUntil(morningJob(env).catch((e) => console.log('cron morning error:', String(e))))
    }
  },
}
