import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quotedInAgorot, quotePrice } from '../lib/quote.js'
import { buildDigestHtml } from '../lib/digest.js'

test('quotedInAgorot: TASE securities (ILA) yes; indices and USD no', () => {
  assert.equal(quotedInAgorot({ currency: 'ILA', isIndex: false }), true)
  assert.equal(quotedInAgorot({ currency: 'ILA', isIndex: true }), false)
  assert.equal(quotedInAgorot({ currency: 'USD', isIndex: false }), false)
  assert.equal(quotedInAgorot(undefined), false)
})

test('quotePrice: ₪35.27 → 3527 agorot; non-agorot and null pass through', () => {
  assert.equal(Math.round(quotePrice(35.27, true) * 100) / 100, 3527)
  assert.equal(quotePrice(35.27, false), 35.27)
  assert.equal(quotePrice(null, true), null)
})

test('digest shows TASE stocks in agorot like Google', () => {
  const html = buildDigestHtml({ dateStr: 'x', all: [{ symbol: 'DSCT.TA', nameHe: 'דיסקונט', priceIls: 35.27, currency: 'ILA', changePct: 3.1 }] })
  assert.match(html, /3,527\.00 אג׳/)
  assert.doesNotMatch(html, /₪35\.27/)
})
