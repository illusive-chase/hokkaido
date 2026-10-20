import { areaById, fmtCount, fmtDate, KIND_LABEL, regions } from '../data'
import { DAYS_LABEL, type DaysBucket, type TripFilter, type TripSort } from '../filters'
import type { Trip, TripKind } from '../types'
import { Chip, Img } from './bits'

const KINDS: TripKind[] = ['itinerary', 'daytrip', 'pilgrimage', 'guide', 'review', 'question']

export function TripFilters({ f, set, count }: { f: TripFilter; set: (f: TripFilter) => void; count: number }) {
  const toggle = <T,>(s: Set<T>, v: T) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n }
  return (
    <div className="filters">
      <input
        className="search"
        type="search"
        placeholder="搜索标题、地点、作者、风格…"
        value={f.q}
        onChange={(e) => set({ ...f, q: e.target.value })}
      />
      <div className="frow">
        <span className="flabel">类型</span>
        {KINDS.map((k) => (
          <Chip key={k} on={f.kinds.has(k)} onClick={() => set({ ...f, kinds: toggle(f.kinds, k) })}>{KIND_LABEL[k]}</Chip>
        ))}
      </div>
      <div className="frow">
        <span className="flabel">经过</span>
        {regions.map((r) => (
          <Chip key={r.id} on={f.regions.has(r.id)} onClick={() => set({ ...f, regions: toggle(f.regions, r.id) })}>{r.name}</Chip>
        ))}
      </div>
      <div className="frow">
        <span className="flabel">天数</span>
        {(Object.keys(DAYS_LABEL) as DaysBucket[]).map((d) => (
          <Chip key={d} on={f.days === d} onClick={() => set({ ...f, days: d })}>{DAYS_LABEL[d]}</Chip>
        ))}
      </div>
      <div className="frow frow-foot">
        <span className="count">{count} 篇</span>
        <label className="sort">
          排序
          <select value={f.sort} onChange={(e) => set({ ...f, sort: e.target.value as TripSort })}>
            <option value="collected">收藏最多</option>
            <option value="recent">最新发布</option>
            <option value="days">天数最多</option>
          </select>
        </label>
      </div>
    </div>
  )
}

export function TripCard({ t, compareSlot, onOpen, onCompare, onHover, compareFull }: {
  t: Trip
  compareSlot: number
  compareFull: boolean
  onOpen: () => void
  onCompare: () => void
  onHover: (on: boolean) => void
}) {
  const bases = t.bases.map((b) => areaById.get(b)?.name).filter(Boolean)
  return (
    <article
      className="card"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button className="card-main" onClick={onOpen}>
        <Img trip={t.id} i={1} thumb className="card-img" />
        <div className="card-body">
          <div className="card-kicker">
            <span>{KIND_LABEL[t.kind]}{t.days ? ` · ${t.days} 天` : ''}</span>
            {t.commercial && <span className="badge">推广</span>}
          </div>
          <h4>{t.src.title}</h4>
          <p className="card-sum">{t.summary}</p>
          <div className="card-meta">
            {bases.length > 0 && <span>住 {bases.join(' / ')}</span>}
            <span>{t.src.author}</span>
            <span>{fmtDate(t.src.publishTime)}</span>
            <span title="收藏">☆ {fmtCount(t.src.counts.collected)}</span>
          </div>
        </div>
      </button>
      {t.route.length > 1 && (
        <button
          className={`cmp-btn ${compareSlot >= 0 ? `on slot-${compareSlot}` : ''}`}
          onClick={onCompare}
          disabled={compareSlot < 0 && compareFull}
          title={compareSlot >= 0 ? '移出对比' : compareFull ? '最多对比 3 条' : '加入对比'}
          aria-pressed={compareSlot >= 0}
        >
          {compareSlot >= 0 ? `对比 ${'ABC'[compareSlot]}` : '＋对比'}
        </button>
      )}
    </article>
  )
}
