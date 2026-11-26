import { lazy, Suspense, useEffect, useState } from 'react'
import PodtrackDebt from './components/PodtrackDebt.jsx'

// Lazy so public pages never load Firebase/Auth.
const App = lazy(() => import('./App.jsx'))

// Hash routes that bypass the login gate. Reachable by direct link only — never linked from the UI.
const PUBLIC_ROUTES = { '#/podtrack-debt': PodtrackDebt }

export default function Root() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const Page = PUBLIC_ROUTES[hash.replace(/\/$/, '')]
  if (Page) return <Page />
  return <Suspense fallback={null}><App /></Suspense>
}
