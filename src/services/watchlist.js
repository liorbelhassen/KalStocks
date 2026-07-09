import { db } from '../firebase'
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'

// Sensible default trigger threshold by instrument type — indices move far less than
// individual stocks, so a 1% index move is roughly as notable as a 3% stock move.
export function defaultThresholdFor(kind) {
  if (kind === 'index' || kind === 'etf') return 1
  return 3
}

// Each watchlist doc is owned by one user (stamped with their auth uid). Doc id = `${uid}__${symbol}`
// so the same symbol is unique per user and re-adding merges instead of duplicating.
const LEGACY_USER_ID = 'me' // single-user MVP data, migrated to the first admin login

const col = collection(db, 'watchlist')
const widOf = (uid, symbol) => `${uid}__${symbol}`

export function subscribeWatchlist(uid, onData, onError) {
  const q = query(col, where('userId', '==', uid))
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError?.(err),
  )
}

export async function addToWatchlist(uid, {
  symbol,
  nameHe,
  priceSymbol,
  kind = 'equity',
  market = 'IL',
  thresholdPct,
  notifyTelegram = false,
  quantity,
}) {
  const sym = symbol.trim()
  if (!sym) return
  const data = {
    userId: uid,
    symbol: sym,
    nameHe: nameHe?.trim() || sym,
    priceSymbol: (priceSymbol || sym).trim(),
    kind,
    market,
    thresholdPct: thresholdPct ?? defaultThresholdFor(kind),
    notifyTelegram,
  }
  if (quantity != null && Number.isFinite(Number(quantity))) data.quantity = Number(quantity)
  // merge so re-importing the same symbol updates it (no duplicate — doc id is per user+symbol).
  await setDoc(doc(col, widOf(uid, sym)), data, { merge: true })
}

export async function updateThreshold(uid, symbol, thresholdPct) {
  const n = Number(thresholdPct)
  if (!Number.isFinite(n) || n <= 0) return
  await updateDoc(doc(col, widOf(uid, symbol)), { thresholdPct: n })
}

export async function updateQuantity(uid, symbol, quantity) {
  const n = Number(quantity)
  await updateDoc(doc(col, widOf(uid, symbol)), { quantity: Number.isFinite(n) && n >= 0 ? n : 0 })
}

// Manual unit price (₪) — used for ETFs, whose real price isn't on the free data source
// (we only have the tracked index level). Lets the holding value be computed correctly.
export async function updatePrice(uid, symbol, price) {
  const n = Number(price)
  await updateDoc(doc(col, widOf(uid, symbol)), { manualPrice: Number.isFinite(n) && n > 0 ? n : null })
}

export async function removeFromWatchlist(uid, symbol) {
  await deleteDoc(doc(col, widOf(uid, symbol)))
}

// One-time migration: adopt the single-user 'me' watchlist into an authenticated account.
// Runs only when the account has no watchlist of its own yet, so it's safe to call on every login.
// Returns the number of adopted rows.
export async function adoptLegacyWatchlist(uid) {
  const mine = await getDocs(query(col, where('userId', '==', uid)))
  if (!mine.empty) return 0 // account already has data — never overwrite it
  const legacy = await getDocs(query(col, where('userId', '==', LEGACY_USER_ID)))
  if (legacy.empty) return 0
  let n = 0
  for (const d of legacy.docs) {
    const data = { ...d.data(), userId: uid }
    await setDoc(doc(col, widOf(uid, data.symbol)), data, { merge: true })
    await deleteDoc(d.ref) // remove the legacy copy so it isn't adopted twice
    n++
  }
  return n
}
