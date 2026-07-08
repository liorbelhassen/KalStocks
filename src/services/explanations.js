import { db } from '../firebase'
import { collection, onSnapshot } from 'firebase/firestore'

// explanations doc id = `${symbol}__${date}`. Collapse to symbol → most recent explanation.
export function subscribeExplanations(onData, onError) {
  return onSnapshot(
    collection(db, 'explanations'),
    (snap) => {
      const bySymbol = {}
      snap.forEach((d) => {
        const e = d.data()
        if (!bySymbol[e.symbol] || (e.at || 0) > (bySymbol[e.symbol].at || 0)) bySymbol[e.symbol] = e
      })
      onData(bySymbol)
    },
    (err) => onError?.(err),
  )
}
