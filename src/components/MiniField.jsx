import { useState } from 'react'

// Compact labeled field (pill: label + borderless input). Keyed by value in the parent.
export default function MiniField({ label, value, onCommit, width = 46 }) {
  const [v, setV] = useState(value ?? '')
  const commit = () => {
    if (onCommit && String(v) !== String(value ?? '')) onCommit(v === '' ? 0 : v)
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '2px 7px', fontSize: 11, color: 'var(--text-dim)' }}>
      {label}
      <input
        type="number" min="0" step="any" value={v} placeholder="0"
        onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
        style={{ width, background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 12.5, fontWeight: 600, direction: 'ltr', textAlign: 'center', outline: 'none', padding: 0 }}
      />
    </span>
  )
}
