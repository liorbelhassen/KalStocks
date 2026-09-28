import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askWithSearch } from '../lib/llm.js'

const geminiBody = (chunks) => ({ candidates: [{ content: { parts: [{ text: 'gemini answer' }] }, groundingMetadata: { groundingChunks: chunks } }] })
const openaiBody = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'openai answer', annotations: [{ type: 'url_citation', title: 'Globes' }] }] }] }

function mockFetch(gemini) {
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    const body = String(url).includes('generativelanguage') ? gemini : openaiBody
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) }
  }
  return calls
}

test('askWithSearch: uncited Gemini answer falls back to OpenAI', async () => {
  const calls = mockFetch(geminiBody([]))
  const r = await askWithSearch('q', { geminiKey: 'g', openaiKey: 'o' })
  assert.equal(r.text, 'openai answer')
  assert.deepEqual(r.sources, ['Globes'])
  assert.equal(calls.length, 2)
})

test('askWithSearch: cited Gemini answer is used as-is', async () => {
  const calls = mockFetch(geminiBody([{ web: { title: 'Calcalist' } }]))
  const r = await askWithSearch('q', { geminiKey: 'g', openaiKey: 'o' })
  assert.equal(r.text, 'gemini answer')
  assert.deepEqual(r.sources, ['Calcalist'])
  assert.equal(calls.length, 1)
})

test('askWithSearch: uncited Gemini answer is returned when no OpenAI key', async () => {
  mockFetch(geminiBody([]))
  const r = await askWithSearch('q', { geminiKey: 'g' })
  assert.equal(r.text, 'gemini answer')
  assert.deepEqual(r.sources, [])
})

test('askWithSearch: OpenAI answer without citations uses the searched pages as sources', async () => {
  const body = { output: [
    { type: 'web_search_call', action: { type: 'search', sources: [{ type: 'url', url: 'https://www.globes.co.il/news/a' }, { type: 'url', url: 'https://www.globes.co.il/news/b' }, { type: 'url', url: 'https://finance.themarker.com/x' }] } },
    { type: 'message', content: [{ type: 'output_text', text: 'openai answer', annotations: [] }] },
  ] }
  globalThis.fetch = async () => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) })
  const r = await askWithSearch('q', { openaiKey: 'o' })
  assert.deepEqual(r.sources, ['globes.co.il', 'finance.themarker.com'])
})
