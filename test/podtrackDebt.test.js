import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGviz, summarizeDebt, sheetUrl } from '../lib/podtrackDebt.js'

const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id) => ({ id, label: id === 'H' ? 'חוב ' : id }))
const row = (a, d, h) => ({ c: [{ v: a }, { v: 'x' }, null, { v: d }, { v: '1.1.26' }, null, { v: 'טרם' }, h === undefined ? { v: null } : h] })

test('summarizeDebt sums only column H and lists rows that have an H value', () => {
  const body = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table: { cols, rows: [
    row('paid', 500),
    row('meat', 1327, { v: 1327, f: '₪1,327.00' }),
    row('credit', 10.94, { v: -10.94 }),
    row('text', 1, { v: '₪1,519.55' }),
    row('blank', 1, null),
  ] } })});`
  const { total, rows, label } = summarizeDebt(parseGviz(body))
  assert.equal(total, 2835.61)
  assert.deepEqual(rows.map((r) => r.item), ['meat', 'credit', 'text'])
  assert.equal(label, 'חוב')
})

test('parseGviz surfaces sheet errors; sheetUrl is cache-busted and read-only', () => {
  assert.throws(() => parseGviz('x({"status":"error","errors":[{"message":"bad sheet"}]})'), /bad sheet/)
  const u = sheetUrl(42)
  assert.match(u, /gviz\/tq\?tqx=out:json&sheet=.+&_=42$/)
})
