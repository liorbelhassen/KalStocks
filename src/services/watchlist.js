import { db } from '../firebase'
import {
  collection,
  doc,
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

// Single-user MVP: a constant owner id stamped on every doc so multi-tenant is a
// later swap to the auth uid (see PROJECT_MEMORY §5). Doc id = `${USER_ID}__${symbol}`.
export const USER_ID = 'me'

const col = collection(db, 'watchlist')
const widOf = (symbol) => `${USER_ID}__${symbol}`

export function subscribeWatchlist(onData, onError) {
  const q = query(col, where('userId', '==', USER_ID))
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => onError?.(err),
  )
}

export async function addToWatchlist({
  symbol,
  nameHe,
  priceSymbol,
  kind = 'equity',
  thresholdPct,
  notifyTelegram = false,
  quantity,
}) {
  const sym = symbol.trim()
  if (!sym) return
  const data = {
    userId: USER_ID,
    symbol: sym,
    nameHe: nameHe?.trim() || sym,
    priceSymbol: (priceSymbol || sym).trim(),
    kind,
    thresholdPct: thresholdPct ?? defaultThresholdFor(kind),
    notifyTelegram,
  }
  if (quantity != null && Number.isFinite(Number(quantity))) data.quantity = Number(quantity)
  // merge so re-importing the same symbol updates it (no duplicate — doc id is per user+symbol).
  await setDoc(doc(col, widOf(sym)), data, { merge: true })
}

export async function updateThreshold(symbol, thresholdPct) {
  const n = Number(thresholdPct)
  if (!Number.isFinite(n) || n <= 0) return
  await updateDoc(doc(col, widOf(symbol)), { thresholdPct: n })
}

export async function updateQuantity(symbol, quantity) {
  const n = Number(quantity)
  await updateDoc(doc(col, widOf(symbol)), { quantity: Number.isFinite(n) && n >= 0 ? n : 0 })
}

// Manual unit price (₪) — used for ETFs, whose real price isn't on the free data source
// (we only have the tracked index level). Lets the holding value be computed correctly.
export async function updatePrice(symbol, price) {
  const n = Number(price)
  await updateDoc(doc(col, widOf(symbol)), { manualPrice: Number.isFinite(n) && n > 0 ? n : null })
}

export async function removeFromWatchlist(symbol) {
  await deleteDoc(doc(col, widOf(symbol)))
}
