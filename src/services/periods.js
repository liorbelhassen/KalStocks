import { db } from '../firebase'
import { collection, onSnapshot } from 'firebase/firestore'

// periods doc id === priceSymbol. { week:{changePct,series,explanation,...}, month:{...} }.
// Updated once a day by the morning job. Keyed by priceSymbol for the dashboard sub-tabs.
export function subscribePeriods(onData, onError) {
  return onSnapshot(
    collection(db, 'periods'),
    (snap) => {
      const byPrice = {}
      snap.forEach((d) => {
        byPrice[d.id] = d.data()
      })
      onData(byPrice)
    },
    (err) => onError?.(err),
  )
}
