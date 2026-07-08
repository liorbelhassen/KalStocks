// Minimal Firestore REST client for the Worker cron poller, authenticated with the Firebase
// service account (JWT → OAuth token, signed with Web Crypto). Lets the Worker write snapshots
// on a reliable Cloudflare cron, instead of relying on flaky GitHub Actions scheduling.

const b64urlStr = (s) =>
  btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlBytes = (buf) => {
  const b = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '')
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

export async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64urlStr(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const toSign = `${header}.${claim}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(toSign))
  const jwt = `${toSign}.${b64urlBytes(sig)}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('token error: ' + JSON.stringify(j).slice(0, 150))
  return j.access_token
}

const base = (pid) => `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`

const decode = (v) => {
  if (!v) return null
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  return null
}

export async function listDocs(token, pid, coll) {
  const res = await fetch(`${base(pid)}/${coll}?pageSize=300`, { headers: { Authorization: `Bearer ${token}` } })
  const j = await res.json()
  return (j.documents || []).map((d) => {
    const o = {}
    for (const k in d.fields || {}) o[k] = decode(d.fields[k])
    return o
  })
}

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } }
  if (typeof v === 'object') {
    const f = {}
    for (const k in v) f[k] = toValue(v[k])
    return { mapValue: { fields: f } }
  }
  return { nullValue: null }
}

export async function patchDoc(token, pid, path, obj) {
  const fields = {}
  for (const k in obj) fields[k] = toValue(obj[k])
  const res = await fetch(`${base(pid)}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(`patch ${path}: ${res.status} ${(await res.text()).slice(0, 150)}`)
}
