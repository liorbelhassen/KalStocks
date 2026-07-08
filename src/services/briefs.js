import { db } from '../firebase'
import { collection, onSnapshot, query, where } from 'firebase/firestore'

const todayIsrael = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())

// Morning "baseline insight" per instrument (keyed by priceSymbol) — shown on the dashboard when
// there's no significant-event explanation, so every stock always has an insight.
export function subscribeBriefs(onData, onError) {
  const q = query(collection(db, 'briefs'), where('date', '==', todayIsrael()))
  return onSnapshot(
    q,
    (snap) => {
      const byPrice = {}
      snap.forEach((d) => {
        const b = d.data()
        byPrice[b.priceSymbol] = b
      })
      onData(byPrice)
    },
    (err) => onError?.(err),
  )
}
