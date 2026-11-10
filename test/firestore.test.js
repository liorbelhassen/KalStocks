import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commitDocs, getDocs } from '../worker/firestore.js'

test('commitDocs/getDocs: encoded paths address the same document as the URL API ("^DJI", not "%5EDJI")', async () => {
  const bodies = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    const found = (body.documents || []).map((name) => ({ found: { name, fields: { v: { integerValue: '1' } } } }))
    return { ok: true, json: async () => found, text: async () => '' }
  }
  await commitDocs('t', 'p', [{ path: `snapshots/${encodeURIComponent('^DJI')}`, obj: { v: 1 } }])
  assert.equal(bodies[0].writes[0].update.name, 'projects/p/databases/(default)/documents/snapshots/^DJI')
  const path = `briefs/${encodeURIComponent('^DJI__2026-09-28')}`
  const out = await getDocs('t', 'p', [path])
  assert.equal(bodies[1].documents[0], 'projects/p/databases/(default)/documents/briefs/^DJI__2026-09-28')
  assert.deepEqual(out[path], { v: 1 })
})
