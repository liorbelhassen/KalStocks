// Provider-agnostic "ask with live web search" — the single entry point for news-grounded
// Hebrew explanations. Tries Gemini first (free tier), and on ANY failure (quota/429/error)
// falls back to OpenAI (paid) if a key is configured. This is what makes assessments reliable:
// Gemini's free-tier throughput ceiling no longer means a missing assessment.
//
// keys = { geminiKey, geminiModel, openaiKey, openaiModel }
import { geminiSearch } from './gemini.js'
import { openaiSearch } from './openai.js'

export async function askWithSearch(prompt, keys = {}, { temperature = 0.4 } = {}) {
  const { geminiKey, geminiModel, openaiKey, openaiModel } = keys
  let geminiErr
  if (geminiKey) {
    try {
      // If OpenAI is available, don't burn time retrying a rate-limited Gemini — fail fast and fall
      // back immediately. Without a fallback, retry Gemini (it's all we have).
      return await geminiSearch(prompt, geminiKey, geminiModel, temperature, openaiKey ? 0 : 2)
    } catch (e) {
      geminiErr = e
      if (!openaiKey) throw e // no fallback available
      // else fall through to OpenAI
    }
  }
  if (openaiKey) {
    try {
      return await openaiSearch(prompt, openaiKey, openaiModel)
    } catch (e) {
      // Surface both failures so logs show why the assessment is missing.
      throw new Error(`both providers failed — gemini: ${geminiErr?.message || 'n/a'} | openai: ${e.message}`)
    }
  }
  throw geminiErr || new Error('no LLM key configured (set GEMINI_API_KEY and/or OPENAI_API_KEY)')
}
