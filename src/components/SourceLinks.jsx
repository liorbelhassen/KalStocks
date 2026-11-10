import { sourceLinks } from '../../lib/sources'

export default function SourceLinks({ sources, symbol }) {
  return sourceLinks(sources, symbol).slice(0, 2).map((s, i) => (
    <span key={s.name}>
      {i ? ', ' : ''}
      {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{s.name}</a> : s.name}
    </span>
  ))
}
