import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, triggerBand } from '../lib/volatility.js'

test('classify: default threshold is 0.5% — a 0.6% day move is significant', () => {
  const c = classify({ changePct: 0.6 })
  assert.equal(c.significant, true)
  assert.equal(c.reason, 'daily-move')
  assert.equal(c.band, 1)
  assert.equal(c.direction, 'up')
})

test('classify: moves below 0.5% are not significant by default', () => {
  assert.equal(classify({ changePct: -0.4 }).significant, false)
})

test('classify: intraday swing triggers at 2× threshold (1% by default)', () => {
  const series = [{ v: 100 }, { v: 101.2 }, { v: 100.1 }]
  const c = classify({ changePct: 0.1, series })
  assert.equal(c.significant, true)
  assert.equal(c.reason, 'intraday-swing')
  assert.equal(classify({ changePct: 0.1, series: [{ v: 100 }, { v: 100.8 }] }).significant, false)
})

test('classify: explicit per-stock threshold still overrides the default', () => {
  assert.equal(classify({ changePct: 0.6 }, 3).significant, false)
  assert.equal(classify({ changePct: -3.2 }, 3).significant, true)
})

test('triggerBand: swing-only move (day band 0) is still level 1; insignificant is 0', () => {
  const swing = classify({ changePct: 0.1, series: [{ v: 100 }, { v: 101.2 }] })
  assert.equal(swing.band, 0)
  assert.equal(triggerBand(swing), 1)
  assert.equal(triggerBand(classify({ changePct: 1.6 })), 3)
  assert.equal(triggerBand(classify({ changePct: 0.2 })), 0)
})
