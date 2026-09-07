# AI Explanation Engine — Audit & Fixes

Scope: the daily / weekly / monthly Hebrew explanations shown on every stock tile, for Israeli (TASE)
and US instruments. Line references marked **(before)** point at the code as it was at commit
`9e3fad2`; **(after)** points at this branch.

---

## 1. Summary for the site owner (non-technical)

**What was broken**

1. **Missing explanations.** When anything went wrong — the price feed, the news feed, the AI
   provider being over quota, or the AI answering with filler — the code silently swallowed the
   error and either saved nothing or saved an empty value. Nothing was logged, so failures were
   invisible. One database call also stopped reading after 300 records, so as the site grew, some
   stocks were simply never processed.
2. **Inaccurate percentages.** The weekly and monthly numbers were computed from the *first bar
   inside* the period instead of the *closing price before* the period, and Yahoo's "5 days" /
   "1 month" shortcuts do not line up with a real calendar week/month. The AI was then told to
   explain a move that never happened at that size (or even direction).
3. **Irrelevant text.** Every stock — including Apple or Nvidia — received the *same* bundle of
   Israeli Telegram headlines (politics, security, TASE) as "context", so US stocks were explained
   with Israeli news. Also, when several ETFs share the TA-35 price, the explanation was written
   for whichever ETF happened to be last in the list, not for the index itself. US stocks were
   described at 09:00 Israel time as if they were "trading today", when Wall Street had not opened.
4. **Stale text.** Weekly/monthly explanations had no date attached, so whatever text was last
   saved (even weeks ago, if the job kept failing) was shown as "this week". The weekly/monthly
   prompt was also fed *today's* headlines, so the model explained a whole month using this
   morning's news. A browser tab left open past midnight kept showing yesterday's "today".

**What was fixed**

- Every stage now either succeeds with a *validated* Hebrew text, or fails loudly with a
  structured log line (stock, period, stage, error). Nothing empty or generic is saved.
- Weekly/monthly returns use the exact calendar window in the instrument's own market timezone and
  the real prior close as the baseline.
- News is matched to the specific company; US stocks never receive Israeli politics headlines;
  weekly/monthly explanations are not built from today's headlines at all.
- Every weekly/monthly explanation is stored with a key that includes the stock, the period type
  and the exact date range. The site refuses to display a text whose window is no longer current.
- The frontend re-subscribes when the Israeli calendar day changes.
- 23 automated tests cover the date windows, the news matching, the prompt inputs and the
  output validation (`npm test`).

**What could not be verified here:** no Gemini / OpenAI / Firebase credentials were available in
this environment, so live end-to-end generation was **not** re-run (see §6). The price side
(Yahoo, no credentials needed) was verified live for `POLI.TA` and `AAPL`.

---

## 2. Pipeline map (as found)

| Cadence | Trigger | Price | News | Prompt / LLM | Store | Render |
|---|---|---|---|---|---|---|
| Daily brief (09:00 / 13:00 IL) | Cloudflare cron `worker/wrangler.toml` → `morningJob` (`worker/worker.js`) — GitHub Action `scripts/morning.mjs` as manual backup | `snapshots/{priceSymbol}` (Yahoo `range=1d`) | `lib/telegram.js` (Telegram public channels + Investing RSS) | `lib/morning.js assessOpen` → `lib/llm.js askWithSearch` (Gemini w/ Google Search, OpenAI fallback) | `briefs/{priceSymbol}__{date}` | `src/services/briefs.js` → `App.jsx` → `tileBits.jsx tileView` |
| Daily event (every 5 min) | `pollPrices` (worker) / `scripts/poll.mjs` | same | same | `lib/explain.js explainMove` | `briefs/...` (worker) or `explanations/{symbol}__{date}` (script) | `src/services/explanations.js` |
| Weekly / Monthly | inside `morningJob` (once a day) and `primeSymbol` (on add) | Yahoo `range=5d` / `range=1mo` | same Telegram bundle | `explainMove` with `period:'week'|'month'` | `periods/{priceSymbol}.{week,month}` | `src/services/periods.js` → `tileBits.jsx periodInsight` |

Daily and week/month share `lib/llm.js` and `lib/telegram.js`; the *period math* was duplicated
three times (`worker.js` morningJob, `worker.js` primeSymbol, `scripts/morning.mjs`) with the same
bug in each copy.

---

## 3. Root causes by symptom

Severity: **H**igh / **M**edium / **L**ow. Frequency is an engineering estimate from reading the
code paths (no production logs were available in this environment).

### 3.1 Missing (empty / no explanation)

| # | Root cause | Where (before) | Why it produces the symptom | Sev | Frequency | Fix |
|---|---|---|---|---|---|---|
| M1 | Week/month LLM failure swallowed: `explainMove(...).catch(() => null)` then `explanation: we?.explanation \|\| null` saved. | `worker/worker.js:183-190`, `:227-231`; `scripts/morning.mjs:114-123` | Any Gemini 429/5xx, OpenAI absence, or network error becomes a *successfully saved* `null`, overwriting the previous good text. No log. | H | Every time Gemini quota is exhausted (~20 req/min free tier, 2 calls × N symbols + retries). Likely daily for large watchlists. | `lib/periods.js buildPeriodsDoc`: failure is logged (`stage`, `symbol`, `period`, `error`); numbers still written; explanation `null` only for a *new* window, existing good text for the same window is kept. |
| M2 | Whole-symbol `catch { /* skip */ }` around the period block. | `worker/worker.js:52-54`, `:86-88`, `:140-142`, `:192-194` | Price fetch or Firestore write error → symbol silently skipped, nothing recorded. | H | Every Yahoo hiccup / rate limit. | `logEvent('error'|'warn', …)` with stage in all five places; per-symbol isolation kept. |
| M3 | Firestore REST `listDocs` reads **one page of 300 docs** and ignores `nextPageToken`. | `worker/firestore.js:64-71` | `briefs` grows by N docs/day; after ~a week the "already explained today" lookup and the `snapshots` load see a truncated list → stocks silently missing from the run / explained on the wrong band. | H | Deterministic once a collection > 300 docs (briefs: within days). | `listDocs` paginates; `getDoc` added for single-document reads. |
| M4 | LLM output not validated: if the retry also failed, the *weak* first answer (or an empty string after `cleanInsight`) was returned and saved. | `lib/explain.js:44-56`, `lib/morning.js:49-64` | `cleanInsight` strips English/URL-heavy lines; a mostly-English or all-link answer becomes `''` → saved as the explanation. | H | Whenever Gemini answers with English or source links (common on US tickers). | `lib/validate.js validateInsight` (non-empty, ≥80 chars, ≤425, Hebrew-dominant, not generic, not template echo); `explainMove` / `assessOpen` **throw** `stage:'validate'` instead of returning. |
| M5 | Period % silently defaulted to `0` when the series had <2 points. | `worker/worker.js:171-174`, `scripts/morning.mjs:102-105` | Model told "the stock moved 0.0% this week" → answers "no significant move / no information" → weak → blank. Also hides a real price-feed failure. | M | Thin-volume TASE names, holidays, new listings. | `periodChange` returns `null`; `computePeriod` throws `stage:'price'`; prompt refuses `changePct == null`. |
| M6 | Client queries pinned to the Israel date at subscription time. | `src/services/explanations.js:10`, `briefs.js:9`, `App.jsx:191` | After midnight the `where('date','==',yesterday)` listener keeps returning yesterday; after the morning job writes today's docs the page shows nothing for "today" until reload (or shows yesterday's — see S3). | M | Every user who leaves the tab open overnight. | `App.jsx` re-subscribes when `todayIsrael()` changes (1-min tick). |
| M7 | `poll.mjs` explains **all** `needsExplanation` events, including ones from previous days that never got explained. | `scripts/poll.mjs:120-127` | Old events consume quota first (and are explained with today's news → also S4), pushing today's over the rate limit. | L | Backup path only. | Events with `date !== today` are retired and logged. |

### 3.2 Inaccurate (does not match the actual move)

| # | Root cause | Where (before) | Why | Sev | Frequency | Fix |
|---|---|---|---|---|---|---|
| I1 | Period return = `(last − first bar) / first bar` inside a `range=5d` / `range=1mo` chart. | `worker/worker.js:171-174,179-180`, `:223-226`; `scripts/morning.mjs:102-111` | The first 30-min bar of Monday is *not* Friday's close; the gap (often the largest move of the week) is dropped. `5d` = 5 *trading* days (spans a holiday week differently), `1mo` is Yahoo's rolling window, not a calendar month. The percentage — sometimes the direction — is wrong, and the prompt then forces the model to justify it. | H | Every week/month explanation; error grows with overnight gaps. | `lib/yahoo.js` accepts exact `period1/period2`; `lib/periods.js periodWindow` computes the calendar window in the market's timezone; `periodChange` uses Yahoo `chartPreviousClose` (close before the window) as baseline. Verified live: POLI.TA week +3.76% vs prior-close 77.61; AAPL month +2.42%. |
| I2 | "Today" was always the **Israel** calendar day and "current session" was always TASE, also for US stocks. | `lib/morning.js:24-31` (`ביום המסחר הנוכחי`, `בבורסת תל אביב`), `worker/worker.js:139` | At 09:00 Israel a US stock's `changePct` is last night's close-to-close; the prompt said it moved that much "today in Tel Aviv". | H | All US instruments, every morning brief. | `buildAssessPrompt` / `buildExplainPrompt` take `market`; US text describes Wall Street's last completed session and says trading has not opened; `periodWindow` uses `America/New_York` for US day boundaries. |
| I3 | `changePct` could be `undefined` / `NaN` and still reach the prompt as `NaN%`. | `lib/explain.js:7-16` | Model invents a move. | M | Missing snapshot / manual-price stocks. | `buildExplainPrompt` throws `stage:'input'` on missing numbers (tested). |
| I4 | Sunday–Thursday vs Monday–Friday trading week was changed in `9e3fad2`; the period math never considered which days are sessions. | (design) | A "week" starting on a non-session day gets a different baseline than intended. | L | — | Baseline is now the last close *before* the window regardless of which weekday it falls on, so the window's first day being a non-session day no longer changes the result. **Holiday calendars are still not modelled** (see §6). |

### 3.3 Irrelevant (wrong company / wrong market / filler)

| # | Root cause | Where (before) | Why | Sev | Frequency | Fix |
|---|---|---|---|---|---|---|
| R1 | One global `telegramContext()` (Israeli Telegram + Investing IL RSS: politics, security, TASE) injected into **every** prompt, including US stocks and week/month. | `worker/worker.js:79,106,139,183,208`; `scripts/morning.mjs:63,71,114`; `scripts/poll.mjs:121` | Prompt text said "use these headlines to identify the dominant event" → Apple explained by a Gaza headline; Hapoalim explained by a Leumi headline. | H | Every US instrument; every IL instrument on days with unrelated big headlines. | `lib/telegram.js`: `fetchHeadlines()` once per run, then `buildNewsContext(items, {market, nameHe, symbol})` per instrument: company-matched headlines (catalog name + aliases + ticker root, sector words like "בנק"/"שבבים" excluded) — US gets **only** those; IL gets those first plus the general Israeli feed. Empty string when nothing matches (model falls back to its own web search). Tested for POLI/LUMI/AAPL/NVDA. |
| R2 | Group representative name: `if (snaps[ps]?.isIndex) repName = w.nameHe` — every watchlist row sharing the TA-35 price **overwrote** the name, so the *last ETF's* name won. | `worker/worker.js:132`; `scripts/morning.mjs:60` | The TA-35 brief/period text was written about "קסם ת"א 35" or whichever ETF came last, and shown under the index and every sibling ETF. | M | Any user with ≥1 IL ETF. | Name is taken from the row whose `symbol === priceSymbol` (the index itself). |
| R3 | `isWeak` (length < 120 or 7 phrases) was the only filter and, when the retry failed, the weak text was still saved. | `lib/llm.js:40-43`, `lib/explain.js:44-56` | "מומלץ לעקוב אחר ההתפתחויות" style filler reached the UI. | M | Every retry failure. | `validateInsight` generic/template lists + hard reject. Prompt also lists the banned phrases. |
| R4 | The prompt did not identify the exchange; "טבע"/"אפל"-like names or a ticker root that exists on two exchanges could pull the wrong company. | `lib/explain.js:17-25` | Search-grounded model picks the more famous namesake. | L | Occasional. | Prompt includes `סימול X, נסחר ב-<exchange>` and an explicit "do not mix with a similarly named company" instruction. `validateInsight` records a `name-not-mentioned` warning in logs. |

### 3.4 Stale (previous period's news or price)

| # | Root cause | Where (before) | Why | Sev | Frequency | Fix |
|---|---|---|---|---|---|---|
| S1 | `periods/{ps}.week/month` had **no date range / key**; `periodInsight` showed `p.explanation` whenever it was non-null. | `worker/worker.js:186-190`; `src/components/tileBits.jsx:24-31` | If the daily refresh failed (M1/M2) — or a stock was removed from all watchlists — the old text stayed forever and was labelled "השבוע". | H | Every failed refresh; permanent for symbols no longer refreshed. | Each entry now carries `key = symbol__period__start_end`, `startDate`, `endDate`, `generatedAt`. `buildPeriodsDoc` reuses text only on an exact key match. `tileBits.isPeriodCurrent` hides explanations whose `endDate` is > 3 days old or missing (legacy). |
| S2 | Week/month prompts received the same **hour-level** headline bundle as the daily prompt. | `lib/explain.js:29`, `worker/worker.js:183-185` | The model attributed a month-long trend to this morning's headline. | H | All week/month explanations. | `buildExplainPrompt` drops `newsContext` for `period !== 'day'` and states the exact `מ-<start> עד <end>` range with "only events inside this range" (tested). |
| S3 | Client date pinned at subscribe (see M6). | `src/services/*.js`, `App.jsx:191` | Yesterday's brief displayed as "☀️ סקירת בוקר" for today. | M | Overnight-open tabs. | Re-subscribe on Israel date change. |
| S4 | Backup poller explained stale `needsExplanation` events with today's headlines (see M7). | `scripts/poll.mjs:120-127` | Yesterday's event, today's news. | L | Backup path. | Retired with a log line. |
| S5 | Period refresh wrote `explanation: null` over a good same-window text when the LLM failed (M1). | `worker/worker.js:186-190` | Fallback factual line replaced a correct text mid-day. | M | Every failed midday refresh. | Same-window text kept; only numbers refreshed. |

---

## 4. Guardrails added

| Requirement | Implementation |
|---|---|
| Reject/retry on missing or stale price data | `lib/periods.js computePeriod` throws `stage:'price'` when the change cannot be computed or the last trade is > 4 days before the window end (`isPriceFresh`). `buildExplainPrompt` / `buildAssessPrompt` throw `stage:'input'` on missing numbers/dates. |
| Structured failure logs | `lib/validate.js logEvent(level, {stage, symbol, period, error, …})` → one JSON line per failure, used in `worker/worker.js`, `scripts/*.mjs`, `lib/telegram.js`, `lib/periods.js`. Stages: `price`, `news`, `input`, `llm`, `validate`, `brief`, `store-snapshot`, `store-periods`. |
| Validate LLM output before saving | `validateInsight`: non-empty, 80–425 chars, Hebrew letters ≥ 40 and ≥ 3× Latin letters, no generic phrases, no echoed format labels. One deeper retry, then **throw** — callers never save a rejected text. |
| Cache key = ticker + period + exact range | `periodKey(symbol, period, startDate, endDate)` stored on every week/month entry; reuse requires exact match; frontend hides non-current entries. Daily docs were already keyed by `{symbol}__{date}`. |
| Batch isolation | Every per-symbol loop (`pollPrices`, `morningJob`, `refreshPeriods`, `primeSymbol`, both scripts) catches and logs per symbol; a failing symbol never aborts the run. |

---

## 5. Tests (`npm test`, Node built-in runner, 23 tests)

- `test/periods.test.js` — day window is the *market's* local day (US at 23:30 NY ≠ Israel's date);
  week/month windows and DST-correct local midnight for `Asia/Jerusalem` and `America/New_York`;
  end-of-month clamping; key uniqueness across day/period/symbol; prior-close baseline vs first-bar;
  `null` instead of `0%`; freshness check; `computePeriod` passes epoch `period1/period2` and
  throws staged errors; `buildPeriodsDoc` reuse / regenerate / never-blank behaviour.
- `test/news.test.js` — ticker↔headline matching for POLI/LUMI/AAPL/NVDA, sector words excluded,
  US context contains no Israeli headlines, empty context when nothing matches.
- `test/prompt.test.js` — prompt refuses missing `changePct`/`date`/name/symbol; injects exact
  stock, market, direction, size, range; week/month drops hourly headlines; US morning wording;
  `validateInsight` accept/reject matrix.

---

## 6. Verification performed and known limits

- `npm run lint` (0 errors), `npm run build` (ok), `npm test` (23/23), worker module graph imports
  cleanly under Node (`worker/worker.js` → `lib/*` → `src/catalog.js`, no bundler-hostile imports).
- **Live price check (no credentials needed)** on 2026-09-07: `computePeriod` for `POLI.TA` and
  `AAPL`, week and month, returned windows `2026-08-31→2026-09-07` / `2026-08-07→2026-09-07`, a
  prior-close baseline and 21–88 bars each.
- **Not performed:** live LLM generation across the sample (no `GEMINI_API_KEY` / `OPENAI_API_KEY`
  / `FIREBASE_SERVICE_ACCOUNT` in this environment). To run it:
  `GEMINI_API_KEY=… FIREBASE_SERVICE_ACCOUNT="$(cat sa.json)" npm run morning` and check the JSON
  log lines (`"level":"warn"|"error"`) plus `periods/*.week.key` in Firestore.
- **Not fixed / out of scope:** TASE and NYSE holiday calendars are not modelled (no calendar
  dependency exists); on a holiday the day brief describes the last completed session and the
  week/month windows still use the prior close, so numbers stay correct but the "today" wording
  may be off. `worker/worker.js pollPrices` still lists the whole `briefs` collection every 5
  minutes (now correctly paginated) — a per-symbol `getDoc` would be cheaper.
- Hebrew/RTL: text is stored as UTF-8 JSON and rendered inside `dir="rtl"` containers; no
  mangling path was found. `cleanInsight` intentionally removes mostly-Latin lines, which is now
  guarded by the Hebrew-ratio validation so it can no longer produce an empty result silently.
