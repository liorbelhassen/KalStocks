# PROJECT_MEMORY.md — KalStocks

> Single source of truth for the KalStocks architecture. Read before making changes.

## 1. What this is
A platform that explains, in plain conversational Hebrew, **why** Tel Aviv (TASE) stocks
move on a given day. It surfaces meaningful daily/hourly moves — not micro-fluctuations —
and explains them using AI that scans global news in any language.

Three surfaces:
1. **Live dashboard** — the user's watchlist as green/red tiles with price, sparkline, and the latest AI explanation.
2. **Telegram push** — real-time alert for flagged stocks when a move crosses the user's threshold.
3. **Email digest** — twice daily, summarizing significant movers and trends with plain-language reasons.

Framing: every explanation carries a confidence level, cites sources, and is labeled
"based on available news — not investment advice."

## 2. Stack
- **Frontend:** React 19 + Vite 8, RTL Hebrew, inline styles (no CSS framework). Charts via `recharts`.
- **Backend/scheduler:** **GitHub Actions cron** (`.github/workflows/poll.yml`) runs `scripts/poll.mjs`
  every 15 min during TASE hours, writing to Firestore via the **Admin SDK** (service account).
  This deliberately AVOIDS Firebase Cloud Functions, which require the paid Blaze plan — the user
  wants everything free. Firebase is used only for **Firestore + Hosting + Auth** (all free on Spark).
- **Data:** Firestore (Spark free tier: 20k writes/day; poller does ~300/day).
- **Email:** Resend (free tier). **Time math:** luxon (`Asia/Jerusalem`).
- **AI (Phase 4):** originally Anthropic Claude API + web search, but the Claude API is PAID → need a
  free alternative (e.g. Google Gemini free tier). Decide when Phase 4 starts.
- No TypeScript, no test suite (matches the user's other projects).
- **Auth to write Firestore from the poller:** a Firebase **service account key** — kept local as
  `serviceAccount.json` (gitignored) for one-off runs, and stored as the GitHub secret
  `FIREBASE_SERVICE_ACCOUNT` for the scheduled workflow.

## 3. Data sources (verified 2026-07)
- **Equities & index:** Yahoo public chart API `query1.finance.yahoo.com/v8/finance/chart/<SYM>`.
  Works free for TASE equities (`POLI.TA`, `LUMI.TA`, `MZTF.TA`, `DSCT.TA`, `FIBI.TA`, …) and `TA35.TA`.
- **Currency:** equities are quoted in **ILA (agorot)** → divide by 100 for ILS. Indices are in points.
- **ETFs (קרנות סל):** NOT available on Yahoo (tested: 1146570, 1148907, 1194380, 5130661, … all 404).
  → **Proxy via `TA35.TA`**; explanation = the index's reason (its heavy constituents). Exact ETF NAV
  would need a paid source (Twelve Data/EODHD ~$79/mo) or scraping — deferred.
- `TA125.TA` returns 404 on Yahoo — index symbol TBD if needed.
- Official TASE Data Hub API exists (Basic tiers free; real-time "Securities Prices Online" $500;
  EoD current $100/yr) with **distribution restrictions** — relevant only for the future commercial path.

## 3b. Firebase project
KalStocks runs on its **own dedicated Firebase project** — **zero connection** to any other project
(separate console, billing, config, Auth pool, Firestore). Standard single-project layout: default
`(default)` Firestore, default functions codebase, default hosting site.

**One-time setup (user, in Firebase console + CLI):**
```bash
# 1. Create a new project in the Firebase console, register a Web app, copy the config into .env.local
#    and the project id into .firebaserc (replace REPLACE_WITH_KALSTOCKS_PROJECT_ID).
# 2. Create the Firestore database (console → Firestore → Create, choose a location), then:
firebase deploy --only firestore   # rules + indexes
```
Deploy: `firebase deploy` (safe — nothing else lives in this project).

## 4. Data model (Firestore)
Explanations are a **shared resource** keyed by `(symbol, eventId)` — the reason a stock moved is the
same for everyone. Only watchlist + alert routing are per-user. This keeps AI cost at one call per event
regardless of audience, and is multi-tenant-ready.

| Collection | Doc | Fields |
|---|---|---|
| `watchlist` | per (user, symbol) | `userId`, `symbol`, `nameHe`, `thresholdPct`, `notifyTelegram` |
| `snapshots` | per symbol | `symbol`, `priceIls`, `changePct`, `previousClose`, `series[]`, `updatedAt` |
| `events` | per detected move | `symbol`, `at`, `changePct`, `direction`, `trigger` |
| `explanations` | per (symbol, eventId) | `text`, `sources[]`, `sentiment`, `confidence`, `at` |
| `alerts_sent` | per (user, eventId, channel) | dedup guard |

## 5. Commercialization hedges (built in from day one)
Single-user MVP now, but designed so multi-tenant SaaS is an extension, not a rewrite:
- Every user-scoped doc carries `userId` (constant for now).
- Explanations shared by `(symbol, event)` — good unit economics.
- Firebase Auth planned early; `userId` field alone already prevents a lock-in.
- Open items for the commercial path: TASE data **redistribution licensing**, and **regulatory framing**
  (avoid being classified as investment advice).

## 6. Build phases
- [x] **0 — Scaffold** (Vite+React shell, Firebase init, docs).
- [x] **1 — Price ingestion:** `scripts/poll.mjs` (GitHub Actions cron) fetches Yahoo → `snapshots`,
  currency-normalized, trading-hours gated. `lib/yahoo.js` done + verified. Pending: service account
  so the poller can actually write (local run + GHA secret).
- [x] **2 — Dashboard live:** subscribes to `snapshots` + `watchlist`; **autocomplete search** over
  `src/catalog.js` (name/alias substring, not security number; "35" → index + all TA-35 ETFs);
  add/remove; favicon. Firestore rules deployed; watchlist RW verified, snapshots client-write denied.
  **ETF proxy:** watchlist docs carry `priceSymbol` (+ `kind`); ETFs set `priceSymbol=TA35.TA` and the
  poller polls unique `priceSymbol`s. Pending: per-symbol threshold editing UI (defaults to 3%).
  Git repo initialized (branch `main`, first commit); not yet pushed to GitHub.
- [ ] **3 — Volatility detection:** thresholds + intraday swings → `events` (inside `scripts/poll.mjs`).
- [ ] **4 — Explanation engine:** LLM + web search → Hebrew explanation + sources + confidence.
  Claude API is paid → evaluate a free alternative (Gemini free tier) first.
- [ ] **5 — Telegram push:** bot, per-stock opt-in, dedup via `alerts_sent` (free).
- [ ] **6 — Email digest:** twice daily via Resend (free tier).
- [ ] **7 — Polish:** honest framing, disclaimers, error handling.

## 7. Notes
- TASE hours: Sun–Thu ~09:30–17:15 (`isTaseOpen` in `scripts/poll.mjs`).
- Firestore rules deployed via `firebase deploy --only firestore --project kalstocks1` (CLI logged in
  as lior.belhassen@gmail.com, which owns kalstocks1).
- Secrets: GHA repo secret `FIREBASE_SERVICE_ACCOUNT`; later RESEND_API_KEY, TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID, and the (free) LLM key.
- Everything on free tiers: Firestore/Hosting/Auth (Spark), GitHub Actions, Resend, Telegram.
