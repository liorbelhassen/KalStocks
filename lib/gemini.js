// Shared Gemini call with retry/backoff. Free-tier enforces ~20 requests/minute; a burst returns
// HTTP 429 with a retry hint. Instead of failing (→ "לא נמצאה הערכה") we wait and retry a few times.
const MAX_WAIT_MS = 12000 // cap each backoff — never let one call hang the whole job

export async function geminiWithRetry(url, payload, { retries = 2 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) return res.json()

    const bodyText = await res.text()
    // Retry on rate-limit (429) and transient server errors (500/503).
    if (res.status === 429 || res.status === 500 || res.status === 503) {
      // A big retryDelay signals a long-window (e.g. daily) quota — waiting it out mid-run is
      // pointless, so we cap every wait at MAX_WAIT_MS and just do a couple of short retries.
      const hinted = +(bodyText.match(/"retryDelay":\s*"(\d+)s"/)?.[1] || 0)
      const waitMs = Math.min(MAX_WAIT_MS, (hinted ? hinted + 1 : Math.pow(2, attempt) * 3) * 1000)
      lastErr = new Error(`Gemini ${res.status}: ${bodyText.slice(0, 200)}`)
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
    }
    throw new Error(`Gemini ${res.status}: ${bodyText.slice(0, 300)}`)
  }
  throw lastErr
}
