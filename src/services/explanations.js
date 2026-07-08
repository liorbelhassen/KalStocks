import { db } from '../firebase'
import { collection, onSnapshot, query, where } from 'firebase/firestore'

// Israel-local date (YYYY-MM-DD), matching the `date` the poller writes (luxon Asia/Jerusalem).
const todayIsrael = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())

// Only today's explanations — keeps client reads bounded as the collection grows over time.
// explanations doc id = `${symbol}__${date}`. Collapse to symbol → most recent explanation.
export function subscribeExplanations(onData, onError) {
  const q = query(collection(db, 'explanations'), where('date', '==', todayIsrael()))
  return onSnapshot(
    q,
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
