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
- **AI (Phase 4):** Google **Gemini** (`gemini-2.5-flash`) with **Google Search grounding** — free tier,
  scans global news and explains in Hebrew with real sources. Chosen over paid Claude API. Key:
  `GEMINI_API_KEY` (local `.secrets.env`; add as GitHub secret for the cloud poller).
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
  poller polls unique `priceSymbol`s. **Settings modal (⚙️)** edits per-symbol alert thresholds
  (presets 0.5/1/2/3/5% + custom); smart defaults by kind (index/etf 1%, equity 3%,
  `defaultThresholdFor`). Threshold shown on each tile. Pushed to github.com/liorbelhassen/KalStocks.
- [x] **3 — Volatility detection:** `lib/volatility.js` `classify()` (daily-move OR intraday-swing);
  poller upserts one `events` doc per (instrument, day), sets `needsExplanation` on new/worsening
  (higher band) moves so Phase 4 explains fresh moves, not every tick. Unit-tested.
- [x] **4 — Explanation engine:** `lib/explain.js` — Gemini + Google Search grounding → Hebrew
  explanation + sources + confidence. Poller explains events with `needsExplanation`, writes
  `explanations` (keyed by eventId = symbol__date), clears the flag (self-heals on transient fail
  next poll). Dashboard subscribes + shows on tiles. Verified end-to-end. NOTE: cloud poller needs
  `GEMINI_API_KEY` GitHub secret, else it skips explanations gracefully.
- [ ] **5 — Telegram push:** bot, per-stock opt-in, dedup via `alerts_sent` (free).
- [x] **6 — Email digest:** `lib/digest.js` (pure RTL-Hebrew HTML builder) + `scripts/digest.mjs`
  (reads today's snapshots/events/explanations, sends via Resend REST). `.github/workflows/digest.yml`
  cron twice daily (10:00 & 15:00 UTC = ~13:00 & 18:00 IDT, Sun–Thu). Verified: HTML builder + Firestore
  read (dry run). Pending from user: `RESEND_API_KEY` + `DIGEST_TO` (Resend signup email; free-tier
  sender `onboarding@resend.dev` can only send to that address) — locally in `.secrets.env` + GitHub secrets.
- [x] **6b — Morning pre-market brief (09:00 IDT):** `lib/morning.js` (`assessOpen` — Gemini +
  grounding researches overnight/global news → plain-Hebrew "how it may open" + sentiment) +
  `scripts/morning.mjs` + `.github/workflows/morning.yml` (cron 06:00 UTC Sun–Thu). Framed as
  assessment, not prediction/advice. Verified live. Needs RESEND_API_KEY + DIGEST_TO to send.
- [x] **6c — Free-tier usage monitor (09:00 daily):** scripts self-count ops into `usage/{date}`
  (`bumpUsage`); `scripts/usage.mjs` + `.github/workflows/usage.yml` email a summary vs free limits
  (`lib/usage.js`). Tracks writes/Gemini calls/emails accurately; reads noted as estimate; GitHub
  Actions (public repo) + Hosting noted as unlimited/negligible. Verified sending.
- Note: LLM responses parsed via **labeled lines** (ביטחון:/הסבר:/סנטימנט:/הערכה:), NOT JSON —
  Hebrew gershayim (ארה"ב, ת"א) break JSON strings. Applies to `explain.js` + `morning.js`.
- [ ] **7 — Polish:** honest framing, disclaimers, error handling.

## 7. Notes
- TASE hours: Sun–Thu ~09:30–17:15 (`isTaseOpen` in `scripts/poll.mjs`).
- Firestore rules deployed via `firebase deploy --only firestore --project kalstocks1` (CLI logged in
  as lior.belhassen@gmail.com, which owns kalstocks1).
- Secrets: GHA repo secret `FIREBASE_SERVICE_ACCOUNT`; later RESEND_API_KEY, TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID, and the (free) LLM key.
- Everything on free tiers: Firestore/Hosting/Auth (Spark), GitHub Actions, Resend, Telegram.
