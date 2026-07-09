// OpenAI (ChatGPT) fallback for when Gemini's free tier is exhausted. Uses the Responses API with
// the built-in web_search tool so it grounds on real-time news (same job as Gemini's grounding).
// Returns { text, sources }. Throws on failure.
const OPENAI_DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

export async function openaiSearch(prompt, apiKey, model = OPENAI_DEFAULT_MODEL) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        tools: [{ type: 'web_search_preview' }],
        input: prompt,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      return parseResponses(data, model)
    }
    const body = await res.text()
    lastErr = new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`)
    // Retry only transient rate-limit/server errors.
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 3000))
      continue
    }
    throw lastErr
  }
  throw lastErr
}

// Vision: describe/extract from an image (used for the screenshot→holdings import). Chat
// Completions with an inline data-URI image. Returns the model's raw text. Throws on failure.
export async function openaiVision(prompt, imageBase64, mimeType = 'image/png', apiKey, model = OPENAI_DEFAULT_MODEL) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI vision ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return (data.choices?.[0]?.message?.content || '').trim()
}

function parseResponses(data, model) {
  // Prefer the convenience aggregate; fall back to walking the output items.
  let text = (data.output_text || '').trim()
  const sources = []
  for (const item of data.output || []) {
    if (item.type !== 'message') continue
    for (const c of item.content || []) {
      if (!text && c.type === 'output_text' && c.text) text = c.text.trim()
      for (const a of c.annotations || []) {
        if (a.type === 'url_citation') sources.push(a.title || a.url)
      }
    }
  }
  return { text, sources: [...new Set(sources.filter(Boolean))].slice(0, 5), provider: `openai:${model}` }
}
