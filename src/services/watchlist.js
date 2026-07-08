import { db } from '../firebase'
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'

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
  thresholdPct = 3,
  notifyTelegram = false,
}) {
  const sym = symbol.trim()
  if (!sym) return
  await setDoc(doc(col, widOf(sym)), {
    userId: USER_ID,
    symbol: sym,
    nameHe: nameHe?.trim() || sym,
    priceSymbol: (priceSymbol || sym).trim(),
    kind,
    thresholdPct,
    notifyTelegram,
  })
}

export async function removeFromWatchlist(symbol) {
  await deleteDoc(doc(col, widOf(symbol)))
}
