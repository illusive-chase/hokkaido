import { useEffect, useState, type ReactNode } from 'react'
import { imgPath, placeById, thumbPath, tripById, TONE_LABEL } from '../data'
import type { Note, Tone } from '../types'
import { knownMedia, mediaUrl } from '../vault'

export function Img({ trip, i, thumb, alt, className }: { trip: string; i: number; thumb?: boolean; alt?: string; className?: string }) {
  const path = thumb ? thumbPath(trip, i) : imgPath(trip, i)
  // 部署出去的图片是密文，要先下载、解密；undefined 是还在解，null 是没有这张图
  const [src, setSrc] = useState(() => knownMedia(path))
  useEffect(() => {
    let live = true
    const known = knownMedia(path)
    setSrc(known)
    if (known === undefined) mediaUrl(path).then((u) => { if (live) setSrc(u) })
    return () => { live = false }
  }, [path])
  if (src === undefined) return <div className={`img-missing loading ${className ?? ''}`} aria-label="正在解密图片" />
  if (src === null) return <div className={`img-missing ${className ?? ''}`} aria-label="本地没有这张图" />
  return (
    <img
      className={className}
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      decoding="async"
      onError={() => setSrc(null)}
    />
  )
}

const TONE_MARK: Record<Tone, string> = { good: '◆', warn: '▲', meh: '◇', info: '·' }

export function ToneMark({ tone }: { tone: Tone }) {
  return <span className={`tone tone-${tone}`} title={TONE_LABEL[tone]} aria-label={TONE_LABEL[tone]}>{TONE_MARK[tone]}</span>
}

export function NoteLine({ note, place, trip, onPlace, onTrip }: {
  note: Note
  place?: boolean
  trip?: string
  onPlace?: (id: string) => void
  onTrip?: (id: string) => void
}) {
  const p = placeById.get(note.place)
  const t = trip ? tripById.get(trip) : null
  return (
    <li className={`note note-${note.tone}`}>
      <ToneMark tone={note.tone} />
      <div>
        {place && p && (
          <button className="link note-place" onClick={() => onPlace?.(p.id)}>{p.name}</button>
        )}
        <p>{note.text}</p>
        <div className="note-meta">
          {note.from === 'comment' && <span>评论区</span>}
          {note.from === 'editor' && <span>整理者注</span>}
          {t && (
            <button className="link" onClick={() => onTrip?.(t.id)}>
              {t.src.author} ·《{t.src.title}》
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

export function Lightbox({ items, start, onClose, caption }: {
  items: { trip: string; i: number }[]
  start: number
  onClose: () => void
  caption?: (it: { trip: string; i: number }) => ReactNode
}) {
  const [k, setK] = useState(start)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setK((x) => Math.min(items.length - 1, x + 1))
      if (e.key === 'ArrowLeft') setK((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [items.length, onClose])
  const it = items[k]
  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        <Img trip={it.trip} i={it.i} />
        <figcaption>
          <span>{caption?.(it)}</span>
          <span className="lb-count">{k + 1} / {items.length}</span>
        </figcaption>
      </figure>
      {k > 0 && <button className="lb-nav lb-prev" aria-label="上一张" onClick={(e) => { e.stopPropagation(); setK(k - 1) }}>‹</button>}
      {k < items.length - 1 && <button className="lb-nav lb-next" aria-label="下一张" onClick={(e) => { e.stopPropagation(); setK(k + 1) }}>›</button>}
      <button className="lb-close" aria-label="关闭" onClick={onClose}>×</button>
    </div>
  )
}

export function Chip({ on, onClick, children, title }: { on?: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button className={`chip ${on ? 'on' : ''}`} aria-pressed={!!on} onClick={onClick} title={title}>{children}</button>
  )
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec">
      <header className="sec-h"><h3>{title}</h3>{aside}</header>
      {children}
    </section>
  )
}
