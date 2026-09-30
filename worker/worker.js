// StocksInsights Worker. Two actions:
//  - vision: a portfolio screenshot → Gemini Vision → detected holdings (Gemini key server-side).
//  - quote:  fetch a live Yahoo snapshot for a symbol (so a manually-added stock loads instantly,
//            without waiting for the scheduled poller — no Gemini involved).
import { fetchSnapshot, fetchSnapshots } from '../lib/yahoo.js'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { commitDocs, getAccessToken, getDoc, getDocs, listDocs, patchDoc } from './firestore.js'
import { assessOpen, buildMorningHtml } from '../lib/morning.js'
import { explainMove } from '../lib/explain.js'
import { visionExtract } from '../lib/vision.js'
import { askWithSearch } from '../lib/llm.js'
import { classify, triggerBand, briefOutdated, keepCheckedBrief } from '../lib/volatility.js'
import { quotedInAgorot } from '../lib/quote.js'
import { fetchHeadlines, buildNewsContext } from '../lib/telegram.js'
import { buildPeriodsDoc, marketOf, marketTz } from '../lib/periods.js'
import { logEvent } from '../lib/validate.js'
import { measuredAnalysis } from '../lib/analysis.js'

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

// The Workers free plan allows 50 subrequests (fetches) per invocation, far fewer than one pass
// over the whole watchlist needs (Yahoo + Firestore + news + LLM per symbol). So each cron only
// dispatches: the work runs in small chunks / per symbol, each in its own invocation via the JOBS
// service binding to this same Worker (`Jobs` entrypoint below), with its own subrequest budget.
const CHUNK = 8
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))
const llmKeys = (env) => ({ geminiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL, openaiKey: env.OPENAI_API_KEY, openaiModel: env.OPENAI_MODEL, openaiVerifyModel: env.OPENAI_VERIFY_MODEL })
const hasLlm = (env) => !!(env.GEMINI_API_KEY || env.OPENAI_API_KEY)
const round2 = (n) => (n != null && Number.isFinite(n) ? Math.round(n * 100) / 100 : null)

async function firestore(env) {
  const sa = JSON.parse(env.SERVICE_ACCOUNT)
  return { token: await getAccessToken(sa), pid: sa.project_id }
}

// Reliable 5-min price poll (Cloudflare cron): dispatches price chunks.
async function pollPrices(env) {
  if (!env.SERVICE_ACCOUNT) return
  if (!marketOpen()) return
  const { token, pid } = await firestore(env)
  const wl = await listDocs(token, pid, 'watchlist')
  const items = new Map()
  for (const w of wl) {
    if (w.kind === 'other') continue // manual-price stocks aren't on Yahoo
    const ps = w.priceSymbol || w.symbol
    if (ps && !items.has(ps)) items.set(ps, { priceSymbol: ps, nameHe: w.nameHe, thresholdPct: w.thresholdPct || 0.5 })
  }
  if (!items.has('TA35.TA')) items.set('TA35.TA', { priceSymbol: 'TA35.TA', snapshotOnly: true }) // ETF proxy price
  const dateStr = ilDateISO()
  const session = Math.floor(minutesInZone('Asia/Jerusalem').min / 60) < 12 ? 'morning' : 'midday'
  await Promise.all(chunks([...items.values()], CHUNK).map((c) =>
    env.JOBS.pollChunk({ items: c, dateStr, session }).catch((e) => logEvent('error', { stage: 'poll-chunk', symbols: c.map((i) => i.priceSymbol), error: String(e) })),
  ))
}

// One chunk: fetch prices, write snapshots in one commit, then explain new significant moves.
// Volatility trigger: when a stock crosses its per-stock threshold, refresh its insight with a
// fresh, direction-aware explanation. Deduped by trigger band so a level isn't re-explained every 5 min.
async function pollChunk(env, { items, dateStr, session }) {
  const { token, pid } = await firestore(env)
  const snaps = await fetchSnapshots(items.map((i) => i.priceSymbol))
  const ok = snaps.filter((s) => !s.error)
  for (const s of snaps) if (s.error) logEvent('warn', { stage: 'price', symbol: s.symbol, error: s.error })
  const now = Date.now()
  await commitDocs(token, pid, ok.map((s) => ({ path: `snapshots/${encodeURIComponent(s.symbol)}`, obj: { ...s, updatedAt: now } })))
  if (!hasLlm(env)) return

  const bySym = Object.fromEntries(ok.map((s) => [s.symbol, s]))
  const briefPath = (ps) => `briefs/${encodeURIComponent(`${ps}__${dateStr}`)}`
  const prior = await getDocs(token, pid, ok.map((s) => briefPath(s.symbol)))
  const due = []
  for (const it of items) {
    const snap = bySym[it.priceSymbol]
    if (!snap || it.snapshotOnly || !tradedToday(snap, marketOf(it.priceSymbol))) continue
    const c = classify(snap, it.thresholdPct || 0.5)
    const band = triggerBand(c)
    const p = prior[briefPath(it.priceSymbol)]
    if (!c.significant || ((p?.band || 0) >= band && !briefOutdated(p, snap.changePct))) continue // level already explained
    due.push({ priceSymbol: it.priceSymbol, nameHe: it.nameHe, isIndex: !!snap.isIndex, changePct: snap.changePct, band, dateStr, session })
  }
  await Promise.all(due.map((d) => env.JOBS.explainMover(d).catch((e) =>
    logEvent('warn', { stage: e.stage || 'brief', symbol: d.priceSymbol, period: 'day', changePct: d.changePct, error: String(e) }))))
}

// The snapshot is from today's session (before the open Yahoo still serves yesterday's bars).
const tradedToday = (snap, market) => {
  const day = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: snap.exchangeTz || marketTz(market) }).format(new Date(ms))
  return day(snap.at) === day(Date.now())
}

// Numbers-only brief for when the AI path throws — a significant move is never left without text.
const measuredBrief = ({ nameHe, isIndex, changePct, market }) => {
  const text = changePct != null && Math.abs(changePct) >= 0.5
    ? measuredAnalysis({ subject: nameHe, isIndex, market, changePct })
    : null
  return text && { assessment: text, sentiment: changePct > 0 ? 'חיובי' : 'שלילי', confidence: 'נמוכה', sources: [], verdict: 'נתונים בלבד' }
}
const headlines = () => fetchHeadlines().catch(() => [])

async function explainMover(env, { priceSymbol: ps, nameHe, isIndex, changePct, band, dateStr, session }) {
  const { token, pid } = await firestore(env)
  const market = marketOf(ps)
  let a
  try {
    const news = buildNewsContext(await headlines(), { market, nameHe, symbol: ps })
    a = await assessOpen({ nameHe, symbol: isIndex ? '' : ps, priceSymbol: ps, market, date: dateStr, isIndex, session, changePct, newsContext: news }, llmKeys(env))
  } catch (e) {
    a = measuredBrief({ nameHe, isIndex, changePct, market })
    if (!a) throw e
    logEvent('warn', { stage: e.stage || 'brief', symbol: ps, period: 'day', changePct, fallback: 'measured', error: String(e) })
  }
  const path = `briefs/${encodeURIComponent(`${ps}__${dateStr}`)}`
  if (keepCheckedBrief(await getDoc(token, pid, path).catch(() => null), a, changePct)) {
    await patchDoc(token, pid, path, { band }, { mask: ['band'] })
    return
  }
  await patchDoc(token, pid, path, {
    priceSymbol: ps, date: dateStr, session, band, assessment: a.assessment, sentiment: a.sentiment, confidence: a.confidence, sources: a.sources || [], verdict: a.verdict, explainedPct: round2(changePct), at: Date.now(),
  })
}

const ilDateISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
const ilDateHe = () =>
  new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())

// Morning brief — reliable 09:00 Israel (Cloudflare cron fires on time). Sends the email +
// writes today's briefs + week/month period data & explanations (per symbol, see `refreshSymbol`).
// Midday (13:00) refreshes the briefs and the week/month numbers — no email. `force` lets the
// admin `refresh` action run a session outside its slot.
async function morningJob(env, { force = null, email = true, only = null } = {}) {
  if (!env.SERVICE_ACCOUNT || !hasLlm(env)) return { skipped: true }
  const ilHour = Math.floor(minutesInZone('Asia/Jerusalem').min / 60)
  const session = force || (ilHour === 9 ? 'morning' : ilHour === 13 ? 'midday' : null)
  if (!session) return { skipped: true } // only the 09:xx or 13:xx slots — DST-safe

  const { token, pid } = await firestore(env)
  const dateStr = ilDateISO()
  const items = await listDocs(token, pid, 'watchlist')
  const snaps = {}
  ;(await listDocs(token, pid, 'snapshots')).forEach((s) => {
    if (s.symbol) snaps[s.symbol] = s
  })

  // 'other' (manual-price) stocks still get a news-based assessment by name — just no periods.
  const groups = new Map()
  for (const w of items) {
    const ps = w.priceSymbol || w.symbol
    if (!ps || (only && !only.includes(ps))) continue
    const isOther = w.kind === 'other'
    if (!groups.has(ps)) groups.set(ps, { priceSymbol: ps, repName: w.nameHe, isIndex: !!snaps[ps]?.isIndex, isOther, symbol: isOther ? '' : ps, changePct: snaps[ps]?.changePct ?? null })
    // Several ETFs share one price symbol (e.g. TA35.TA). Describe the group by the instrument that
    // IS the price symbol (the index), never by whichever ETF happened to be listed last.
    if (w.symbol === ps) groups.get(ps).repName = w.nameHe
  }

  const results = await Promise.all(chunks([...groups.values()], CHUNK).map((c) =>
    env.JOBS.refreshChunk({ groups: c, session, dateStr }).catch((e) => {
      logEvent('error', { stage: 'refresh-chunk', symbols: c.map((g) => g.priceSymbol), error: String(e) })
      return {}
    }),
  ))
  const assessments = Object.assign({}, ...results)
  const summary = { session, dateStr, symbols: groups.size, assessed: Object.keys(assessments).length }

  if (session !== 'morning' || !email) {
    console.log(`${session} refresh done`, JSON.stringify(summary))
    return summary
  }

  // Digest goes only to DIGEST_TO for now → email only that user's own portfolio.
  const users = await listDocs(token, pid, 'users')
  const digestUid = users.find((u) => u.email && u.email === env.DIGEST_TO)?.uid || null
  const emailSource = digestUid ? items.filter((w) => w.userId === digestUid) : items
  const emailItems = emailSource
    .filter((w) => w.kind !== 'other')
    .map((w) => {
      const ps = w.priceSymbol || w.symbol
      const a = assessments[ps] || {}
      return { symbol: w.symbol, nameHe: w.nameHe, kind: w.kind, currency: (w.market || 'IL') === 'US' ? '$' : '₪', isIndex: snaps[ps]?.isIndex, agorot: quotedInAgorot(snaps[ps]), priceIls: snaps[ps]?.priceIls, assessment: a.assessment || 'לא נמצאה הערכה.', sentiment: a.sentiment, confidence: a.confidence, sources: a.sources }
    })
  const html = buildMorningHtml({ dateStr: ilDateHe(), items: emailItems, session: 'morning' })
  if (env.RESEND_API_KEY && env.DIGEST_TO) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.DIGEST_FROM || 'StocksInsights <onboarding@resend.dev>', to: env.DIGEST_TO, subject: `☀️ סקירת בוקר StocksInsights · ${dateStr}`, html }),
    })
  }
  console.log('morning job done', JSON.stringify(summary))
  return summary
}

// Symbols of one chunk, one invocation each, in parallel (each waits minutes on deep research).
async function refreshChunk(env, { groups, session, dateStr }) {
  const out = {}
  await Promise.all(groups.map(async (g) => {
    try {
      const a = await env.JOBS.refreshSymbol({ g, session, dateStr })
      if (a) out[g.priceSymbol] = a
    } catch (e) {
      logEvent('error', { stage: 'refresh-symbol', symbol: g.priceSymbol, error: String(e) })
    }
  }))
  return out
}

// Today's brief for one instrument, with its week and month periods in parallel invocations (each
// its own subrequest budget). Returns the assessment (for the email).
async function refreshSymbol(env, { g, session, dateStr }) {
  const periods = g.isOther ? [] : ['week', 'month'].map((period) => // no Yahoo series for manual-price stocks
    env.JOBS.refreshPeriod({ g, period }).catch((e) => logEvent('error', { stage: 'store-periods', symbol: g.priceSymbol, period, error: String(e) })))
  const [a] = await Promise.all([refreshBrief(env, { g, session, dateStr }), ...periods])
  return a
}

async function refreshBrief(env, { g, session, dateStr }) {
  const { token, pid } = await firestore(env)
  const keys = llmKeys(env)
  const market = marketOf(g.priceSymbol)
  const news = buildNewsContext(await headlines(), { market, nameHe: g.repName, symbol: g.priceSymbol }) // real headlines (anti-hallucination)
  const changePct = session === 'midday' || g.useChange ? g.changePct : null
  let a = null
  try {
    a = await assessOpen({ nameHe: g.repName, symbol: g.symbol, priceSymbol: g.priceSymbol, market, date: dateStr, isIndex: !!g.isIndex, session, changePct, newsContext: news }, keys)
    const existing = await getDoc(token, pid, `briefs/${encodeURIComponent(`${g.priceSymbol}__${dateStr}`)}`).catch(() => null)
    if (keepCheckedBrief(existing, a, changePct ?? g.changePct)) return { ...a, ...existing }
    await patchDoc(token, pid, `briefs/${encodeURIComponent(`${g.priceSymbol}__${dateStr}`)}`, {
      priceSymbol: g.priceSymbol, date: dateStr, session, assessment: a.assessment, sentiment: a.sentiment, confidence: a.confidence, sources: a.sources || [], verdict: a.verdict, explainedPct: round2(changePct), at: Date.now(),
    })
  } catch (e) {
    logEvent('warn', { stage: e.stage || 'brief', symbol: g.priceSymbol, period: 'day', session, error: e.message })
    const fb = !a && measuredBrief({ nameHe: g.repName, isIndex: !!g.isIndex, changePct: g.changePct, market })
    if (fb) {
      a = fb
      await patchDoc(token, pid, `briefs/${encodeURIComponent(`${g.priceSymbol}__${dateStr}`)}`, {
        priceSymbol: g.priceSymbol, date: dateStr, session, ...fb, explainedPct: round2(g.changePct), at: Date.now(),
      }).catch((err) => logEvent('error', { stage: 'store-brief', symbol: g.priceSymbol, error: String(err) }))
    }
  }
  return a
}

// One period (week or month) of `periods/{symbol}`: data + explanation. Explanations are keyed by
// the exact window (symbol + period + start/end dates), so a stale text is never re-served for a
// new window. Only that period's field is written, so week and month can run in parallel.
async function refreshPeriod(env, { g, period }) {
  const { token, pid } = await firestore(env)
  const ps = g.priceSymbol
  const path = `periods/${encodeURIComponent(ps)}`
  const existing = await getDoc(token, pid, path).catch(() => null)
  const { doc } = await buildPeriodsDoc({ symbol: ps, nameHe: g.repName || ps, keys: llmKeys(env), existing, fetchSnapshot, explainMove, periods: [period] })
  if (!doc[period]) return
  await patchDoc(token, pid, path, doc, { mask: ['symbol', 'market', 'updatedAt', period] })
}

// On-demand generation for a single instrument (when a user just added it) — today's brief +
// week/month periods, so the reviews appear within seconds instead of waiting for the morning cron.
async function primeSymbol(env, symbol, nameHe, isIndex) {
  const dateStr = ilDateISO()
  const session = Math.floor(minutesInZone('Asia/Jerusalem').min / 60) < 12 ? 'morning' : 'midday'
  // Current-day change so the just-added stock's insight matches its actual direction.
  let snap = null
  if (!symbol.startsWith('X-')) { try { snap = await fetchSnapshot(symbol) } catch { /* ignore */ } }
  const changePct = snap?.changePct ?? null
  const isOther = symbol.startsWith('X-')
  await refreshSymbol(env, { g: { priceSymbol: symbol, repName: nameHe, isIndex, isOther, symbol: isIndex ? '' : symbol, changePct, useChange: true }, session, dateStr })
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

      // Admin: run the morning/midday refresh now (briefs + week/month periods), without email.
      // Runs in the request itself (a waitUntil task would be cut off after 30 s).
      if (body.action === 'refresh') {
        if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403, origin)
        return json(await morningJob(env, { force: body.session === 'midday' ? 'midday' : 'morning', email: false, only: Array.isArray(body.symbols) ? body.symbols : null }), 200, origin)
      }

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

// Internal jobs, reached only through the JOBS service binding (RPC — not exposed over HTTP).
// Each call is a separate invocation with its own subrequest budget.
export class Jobs extends WorkerEntrypoint {
  pollChunk(args) { return pollChunk(this.env, args) }
  explainMover(args) { return explainMover(this.env, args) }
  refreshChunk(args) { return refreshChunk(this.env, args) }
  refreshSymbol(args) { return refreshSymbol(this.env, args) }
  refreshPeriod(args) { return refreshPeriod(this.env, args) }
}
