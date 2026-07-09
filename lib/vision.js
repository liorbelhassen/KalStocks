// Provider-agnostic image extraction for the screenshot→holdings import. Gemini Vision (free)
// first, OpenAI Vision (paid) fallback when Gemini's quota is exhausted — same reliability story
// as lib/llm.js, but for images. Returns { text, provider }. keys = { geminiKey, geminiModel,
// openaiKey, openaiModel }.
import { geminiWithRetry } from './gemini.js'
import { openaiVision } from './openai.js'

export async function visionExtract({ imageBase64, mimeType = 'image/png', prompt }, keys = {}) {
  const { geminiKey, geminiModel, openaiKey, openaiModel } = keys
  let geminiErr
  if (geminiKey) {
    try {
      const model = geminiModel || 'gemini-2.5-flash'
      const data = await geminiWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
          generationConfig: { temperature: 0.1 },
        },
      )
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('\n')
      return { text, provider: `gemini:${model}` }
    } catch (e) {
      geminiErr = e
      if (!openaiKey) throw e
    }
  }
  if (openaiKey) {
    const text = await openaiVision(prompt, imageBase64, mimeType, openaiKey, openaiModel)
    return { text, provider: `openai:${openaiModel || 'gpt-4o-mini'}` }
  }
  throw geminiErr || new Error('no vision key configured (set GEMINI_API_KEY and/or OPENAI_API_KEY)')
}
