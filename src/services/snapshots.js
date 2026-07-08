import { db } from '../firebase'
import { collection, onSnapshot } from 'firebase/firestore'

// snapshots doc id === symbol (written by the pollPrices Cloud Function).
export function subscribeSnapshots(onData, onError) {
  return onSnapshot(
    collection(db, 'snapshots'),
    (snap) => {
      const bySymbol = {}
      snap.forEach((d) => {
        bySymbol[d.id] = d.data()
      })
      onData(bySymbol)
    },
    (err) => onError?.(err),
  )
}
