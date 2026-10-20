import { useMemo, useState } from 'react'
import { areaById, KIND_LABEL, PLACE_KIND_LABEL, placeAgg, regions, themes, tripById } from '../data'
import type { PlaceFilter, PlaceRow } from '../filters'
import type { Tone, Trip } from '../types'
import { Chip, Img, Lightbox, NoteLine, Section, ToneMark } from './bits'

export function PlaceFilters({ f, set, count }: { f: PlaceFilter; set: (f: PlaceFilter) => void; count: number }) {
  const toggle = (s: Set<string>, v: string) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n }
  return (
    <div className="filters">
      <input className="search" type="search" placeholder="搜索地点（中文 / 日文）…" value={f.q} onChange={(e) => set({ ...f, q: e.target.value })} />
      <div className="frow">
        <span className="flabel">区域</span>
        {regions.map((r) => <Chip key={r.id} on={f.regions.has(r.id)} onClick={() => set({ ...f, regions: toggle(f.regions, r.id) })}>{r.name}</Chip>)}
      </div>
      <div className="frow">
        <span className="flabel">主题</span>
        {themes.map((t) => <Chip key={t} on={f.theme === t} onClick={() => set({ ...f, theme: f.theme === t ? null : t })}>{t}</Chip>)}
      </div>
      <div className="frow frow-foot">
        <span className="count">{count} 个地点 · 在地图上方切换景点、饮食、交通、住宿</span>
      </div>
    </div>
  )
}

export function PlaceList({ rows, max, onPick, onHover }: { rows: PlaceRow[]; max: number; onPick: (id: string) => void; onHover: (id: string | null) => void }) {
  return (
    <ol className="plist">
      {rows.map((r) => (
        <li key={r.place.id}>
          <button onClick={() => onPick(r.place.id)} onMouseEnter={() => onHover(r.place.id)} onMouseLeave={() => onHover(null)}>
            <span className="pl-name">
              {r.place.name}
              <small>{areaById.get(r.place.area)?.name} · {PLACE_KIND_LABEL[r.place.kind]}</small>
            </span>
            <span className="pl-bar" aria-hidden><i style={{ width: `${(r.n / max) * 100}%` }} /></span>
            <span className="pl-n">{r.n}<small> 篇</small></span>
            <span className="pl-notes">
              {r.good > 0 && <span><ToneMark tone="good" />{r.good}</span>}
              {r.warn > 0 && <span><ToneMark tone="warn" />{r.warn}</span>}
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

const TONE_ORDER: Tone[] = ['good', 'warn', 'meh', 'info']
const TONE_TITLE: Record<Tone, string> = { good: '推荐', warn: '注意事项', meh: '觉得一般', info: '信息' }

export function PlaceDetail({ id, inScope, onBack, onTrip, onPlace, backLabel }: {
  id: string
  inScope: Set<string>
  onBack: () => void
  onTrip: (id: string) => void
  onPlace: (id: string) => void
  backLabel: string
}) {
  const agg = placeAgg.get(id)!
  const p = agg.place
  const [lb, setLb] = useState<number | null>(null)
  const [onlyScope, setOnlyScope] = useState(false)

  const visits = useMemo(() => {
    const v = agg.visits.filter((x) => !onlyScope || inScope.has(x.trip))
    return v.sort((a, b) => (a.role === b.role ? tripById.get(b.trip)!.src.counts.collected - tripById.get(a.trip)!.src.counts.collected : a.role === 'route' ? -1 : 1))
  }, [agg, onlyScope, inScope])
  const notes = agg.notes.filter((n) => !onlyScope || inScope.has(n.trip))
  const photos = useMemo(() => {
    const own = agg.photos.map((x) => ({ trip: x.trip, i: x.img }))
    return own
  }, [agg])
  const outOfScope = agg.visits.filter((v) => !inScope.has(v.trip)).length

  // 同一天前后的地点：帮助理解「通常怎么串」
  const neighbours = useMemo(() => {
    const c = new Map<string, number>()
    for (const v of agg.visits) {
      const t = tripById.get(v.trip)!
      for (const d of t.plan ?? []) {
        const k = d.stops.indexOf(id)
        if (k < 0) continue
        for (const j of [k - 1, k + 1]) {
          const n = d.stops[j]
          if (n && n !== id) c.set(n, (c.get(n) ?? 0) + 1)
        }
      }
    }
    return [...c].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [agg, id])

  return (
    <div className="detail">
      <div className="detail-top">
        <button className="back" onClick={onBack}>← {backLabel}</button>
      </div>
      <header className="detail-h">
        <div className="kicker">{areaById.get(p.area)?.name} · {PLACE_KIND_LABEL[p.kind]}{p.approx ? ' · 位置为大致' : ''}</div>
        <h2>{p.name}</h2>
        {p.ja && p.ja !== p.name && <div className="ja">{p.ja}</div>}
        {p.blurb && <p className="lede">{p.blurb}</p>}
        <div className="byline">
          <span>{agg.visits.length} 篇帖子提到</span>
          <span>{agg.visits.filter((v) => v.role === 'route').length} 条行程经过</span>
          <span>{agg.notes.length} 条经验</span>
          <a href={`https://www.google.com/maps/search/?api=1&query=${p.at[1]},${p.at[0]}`} target="_blank" rel="noreferrer">Google 地图 ↗</a>
        </div>
        {p.themes.length > 0 && <div className="themes">{p.themes.map((t) => <span key={t}>{t}</span>)}</div>}
      </header>

      {photos.length > 0 && (
        <div className="hero-strip">
          {photos.map((ph, k) => (
            <button key={k} className="hero-img" onClick={() => setLb(k)}>
              <Img trip={ph.trip} i={ph.i} thumb />
            </button>
          ))}
        </div>
      )}

      {outOfScope > 0 && (
        <label className="toggle scope">
          <input type="checkbox" checked={onlyScope} onChange={(e) => setOnlyScope(e.target.checked)} />
          只看当前筛选内的帖子（隐藏 {outOfScope} 篇）
        </label>
      )}

      {notes.length > 0 && TONE_ORDER.map((tone) => {
        const list = notes.filter((n) => n.tone === tone)
        if (!list.length) return null
        return (
          <Section key={tone} title={TONE_TITLE[tone]} aside={<span className="aside">{list.length}</span>}>
            <ul className="notes">{list.map((n, k) => <NoteLine key={k} note={n} trip={n.trip} onTrip={onTrip} />)}</ul>
          </Section>
        )
      })}

      {agg.ratings.length > 0 && (
        <Section title="评分">
          <ul className="ratings">
            {agg.ratings.map((r) => (
              <li key={r.trip}>
                <button className="link" onClick={() => onTrip(r.trip)}>{tripById.get(r.trip)!.src.author}</button>
                <span className="bar" aria-hidden><i style={{ width: `${(r.score / 5) * 100}%` }} /></span>
                <span className="rlabel">{r.label}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {neighbours.length > 0 && (
        <Section title="常和它排在同一天">
          <div className="stops">
            {neighbours.map(([n, c]) => (
              <button key={n} className="stop" onClick={() => onPlace(n)}>{placeAgg.get(n)?.place.name}<small> ×{c}</small></button>
            ))}
          </div>
        </Section>
      )}

      <Section title="提到它的帖子" aside={<span className="aside">{visits.length}</span>}>
        <ul className="vlist">
          {visits.map((v) => {
            const t = tripById.get(v.trip) as Trip
            return (
              <li key={v.trip}>
                <button onClick={() => onTrip(t.id)}>
                  <Img trip={t.id} i={1} thumb className="v-img" />
                  <span>
                    <b>{t.src.title}</b>
                    <small>
                      {KIND_LABEL[t.kind]}
                      {v.role === 'route' && v.days.length > 0 ? ` · 第 ${v.days.join('、')} 天` : v.role === 'mention' ? ' · 仅提及' : ''}
                      {!inScope.has(t.id) ? ' · 不在当前筛选' : ''}
                    </small>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Section>

      {lb !== null && (
        <Lightbox items={photos} start={lb} onClose={() => setLb(null)} caption={(it) => tripById.get(it.trip)?.src.title} />
      )}
    </div>
  )
}
