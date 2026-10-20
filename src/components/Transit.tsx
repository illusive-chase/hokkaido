import { useMemo } from 'react'
import { fmtCount, KIND_LABEL, regions, TONE_LABEL, tripById } from '../data'
import type { TransitFilter } from '../filters'
import { areaName, distanceKm, MODE_LABEL, MODES, tripTransit, type EdgeView, type Hop } from '../transit'
import type { Leg, LegNote, TransitMode, Trip } from '../types'
import { Chip, Section, ToneMark } from './bits'

const toggle = <T,>(s: Set<T>, v: T) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n }

export function ModeTags({ modes }: { modes?: TransitMode[] }) {
  if (!modes?.length) return null
  return <span className="modes">{modes.map((m) => <span key={m} className={`mode mode-${m}`}>{MODE_LABEL[m]}</span>)}</span>
}

const Chain = ({ chain }: { chain: string[] }) => (
  <span className="chain">
    {chain.map((a, k) => <span key={k}>{k > 0 && <i aria-hidden>→</i>}{areaName(a)}</span>)}
  </span>
)

/** 没有自己的行程（经验帖、提问帖）时，列出正文和评论区提到的路段 */
function EdgeNames({ legs }: { legs: Leg[] }) {
  const seen = new Map<string, [string, string]>()
  for (const l of legs) {
    const k = [...l.between].sort().join('~')
    if (!seen.has(k)) seen.set(k, l.between)
  }
  if (!seen.size) return <span className="chain muted">没有跨城市的行程</span>
  const list = [...seen.values()]
  return (
    <span className="chain chain-edges">
      <small>提到的路段</small>
      {list.slice(0, 5).map(([a, b], k) => <span key={k}>{areaName(a)}—{areaName(b)}</span>)}
      {list.length > 5 && <span className="muted">等 {list.length} 段</span>}
    </span>
  )
}

export function TransitFilters({ f, set, count, unit }: { f: TransitFilter; set: (f: TransitFilter) => void; count: number; unit: string }) {
  return (
    <div className="filters">
      <input
        className="search"
        type="search"
        placeholder="搜索城市、车次、价格、注意事项…"
        value={f.q}
        onChange={(e) => set({ ...f, q: e.target.value })}
      />
      <div className="frow">
        <span className="flabel">方式</span>
        {MODES.map((m) => <Chip key={m} on={f.modes.has(m)} onClick={() => set({ ...f, modes: toggle(f.modes, m) })}>{MODE_LABEL[m]}</Chip>)}
      </div>
      <div className="frow">
        <span className="flabel">经过</span>
        {regions.map((r) => <Chip key={r.id} on={f.regions.has(r.id)} onClick={() => set({ ...f, regions: toggle(f.regions, r.id) })}>{r.name}</Chip>)}
      </div>
      <div className="frow frow-foot">
        <span className="count">{count} {unit}</span>
        <span className="count">实线：有帖子写了怎么走 · 虚线：只是行程经过</span>
      </div>
    </div>
  )
}

/** 城际图层的帖子卡片：只有路线、交通方式和交通经验的数量，没有封面和概括 */
export function TransitCard({ t, onOpen, onHover }: { t: Trip; onOpen: () => void; onHover: (on: boolean) => void }) {
  const x = tripTransit.get(t.id)!
  const warn = x.legs.reduce((s, l) => s + (l.notes ?? []).filter((n) => n.tone === 'warn').length, 0)
  return (
    <article className="tcard" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <button onClick={onOpen}>
        {x.chain.length > 1 ? <Chain chain={x.chain} /> : <EdgeNames legs={x.legs} />}
        <div className="tcard-meta">
          <ModeTags modes={x.modes} />
          {x.legs.length > 0 && <span>{x.legs.length} 段走法</span>}
          {warn > 0 && <span className="warn-n"><ToneMark tone="warn" />{warn}</span>}
          {x.tips.length > 0 && <span>{x.tips.length} 条交通建议</span>}
        </div>
        <div className="tcard-src">{t.src.title} · {t.src.author}{t.days ? ` · ${t.days} 天` : ''}</div>
      </button>
    </article>
  )
}

export function EdgeList({ edges, onPick, onHover }: { edges: EdgeView[]; onPick: (key: string) => void; onHover: (key: string | null) => void }) {
  const max = Math.max(1, ...edges.map((e) => e.trips.length))
  return (
    <ol className="plist elist">
      {edges.map((e) => (
        <li key={e.key}>
          <button onClick={() => onPick(e.key)} onMouseEnter={() => onHover(e.key)} onMouseLeave={() => onHover(null)}>
            <span className="pl-name">
              {areaName(e.a)} — {areaName(e.b)}
              <small>{e.modes.length ? e.modes.slice(0, 4).map(([m]) => MODE_LABEL[m]).join(' · ') : '没有帖子写怎么走'}</small>
            </span>
            <span className="pl-bar" aria-hidden><i style={{ width: `${(e.trips.length / max) * 100}%` }} /></span>
            <span className="pl-n">{e.trips.length}<small> 篇</small></span>
            <span className="pl-notes">
              {e.notes.some((n) => n.tone === 'warn') && <span><ToneMark tone="warn" />{e.notes.filter((n) => n.tone === 'warn').length}</span>}
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

function LegNotes({ notes }: { notes?: LegNote[] }) {
  if (!notes?.length) return null
  const order = { warn: 0, meh: 1, good: 2, info: 3 }
  return (
    <ul className="notes leg-notes">
      {[...notes].sort((a, b) => order[a.tone] - order[b.tone]).map((n, k) => (
        <li key={k} className={`note note-${n.tone}`}>
          <ToneMark tone={n.tone} />
          <div>
            <p>{n.text}</p>
            {n.from !== 'post' && <div className="note-meta"><span>{n.from === 'comment' ? '评论区' : '整理者注'}</span></div>}
          </div>
        </li>
      ))}
    </ul>
  )
}

function LegBlock({ l, showEnds }: { l: Leg; showEnds?: boolean }) {
  const facts = [l.time && `⏱ ${l.time}`, l.cost && `¥ ${l.cost}`].filter(Boolean)
  return (
    <div className="leg">
      <div className="leg-h">
        <ModeTags modes={l.mode} />
        {showEnds !== false && <span className="leg-dir">{areaName(l.between[0])} → {areaName(l.between[1])}</span>}
        {l.day != null && <span className="leg-day">D{l.day}</span>}
        {l.from === 'comment' && <span className="leg-from">评论区</span>}
      </div>
      {l.how && <p className="leg-how">{l.how}</p>}
      {facts.length > 0 && <p className="leg-facts">{facts.join('　')}</p>}
      <LegNotes notes={l.notes} />
    </div>
  )
}

/** 点地图上的一条边：这两个城市之间，各帖子怎么走、要注意什么 */
export function EdgeDetail({ e, onBack, backLabel, onTrip, onCity }: {
  e: EdgeView
  onBack: () => void
  backLabel: string
  onTrip: (id: string) => void
  onCity: (id: string) => void
}) {
  const byTrip = useMemo(() => {
    const m = new Map<string, Leg[]>()
    for (const l of e.legs) m.set(l.trip, [...(m.get(l.trip) ?? []), l])
    const score = (id: string) => (m.get(id) ?? []).reduce((s, l) => s + 2 + (l.notes?.length ?? 0) + (l.how ? 1 : 0), 0)
    return [...m.keys()].sort((x, y) => score(y) - score(x) || tripById.get(y)!.src.counts.collected - tripById.get(x)!.src.counts.collected)
      .map((id) => ({ trip: tripById.get(id)!, legs: m.get(id)! }))
  }, [e])
  const warns = e.notes.filter((n) => n.tone === 'warn')
  const km = distanceKm(e.a, e.b)

  return (
    <div className="detail">
      <div className="detail-top">
        <button className="back" onClick={onBack}>← {backLabel}</button>
      </div>
      <header className="detail-h">
        <div className="kicker">城际路段{km ? ` · 直线约 ${km} 公里` : ''}</div>
        <h2>
          <button className="link-ink" onClick={() => onCity(e.a)}>{areaName(e.a)}</button>
          <span className="edge-sep"> — </span>
          <button className="link-ink" onClick={() => onCity(e.b)}>{areaName(e.b)}</button>
        </h2>
        <div className="byline">
          <span>{e.trips.length} 篇帖子经过</span>
          <span>{byTrip.length} 篇写了怎么走</span>
          {warns.length > 0 && <span>{warns.length} 条注意</span>}
        </div>
        {e.modes.length > 0 && (
          <div className="mode-tally">
            {e.modes.map(([m, n]) => <span key={m}><span className={`mode mode-${m}`}>{MODE_LABEL[m]}</span>×{n}</span>)}
          </div>
        )}
      </header>

      {byTrip.length > 0 && (
        <Section title="各帖子的走法" aside={<span className="aside">{e.legs.length} 条</span>}>
          <ul className="by-trip">
            {byTrip.map(({ trip, legs }) => (
              <li key={trip.id}>
                <button className="by-trip-h" onClick={() => onTrip(trip.id)}>
                  <b>{trip.src.author}</b>
                  <span>《{trip.src.title}》{trip.days ? ` · ${trip.days} 天` : ''}{trip.when ? ` · ${trip.when}` : ''}</span>
                </button>
                {legs.map((l, k) => <LegBlock key={k} l={l} />)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {e.routeOnly.length > 0 && (
        <Section title="经过但没写怎么走" aside={<span className="aside">{e.routeOnly.length} 篇</span>}>
          <ul className="vlist plain">
            {e.routeOnly.map(({ trip, hops }) => {
              const t = tripById.get(trip)!
              return (
                <li key={trip}>
                  <button onClick={() => onTrip(trip)}>
                    <span>
                      <b>{t.src.title}</b>
                      <small>{t.src.author} · {hops.map(hopText).join('；')}</small>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>
      )}
    </div>
  )
}

const hopText = (h: Hop) => `${areaName(h.from)} → ${areaName(h.to)}${h.day != null ? ` D${h.day}` : ''}${h.move ? `（当天：${h.move}）` : ''}`

/** 点地图上的一个城市：它和哪些城市之间有帖子走过 */
export function CityDetail({ id, edges, onBack, backLabel, onEdge, onHoverEdge }: {
  id: string
  edges: EdgeView[]
  onBack: () => void
  backLabel: string
  onEdge: (key: string) => void
  onHoverEdge: (key: string | null) => void
}) {
  const mine = edges.filter((e) => e.a === id || e.b === id).sort((x, y) => y.trips.length - x.trips.length)
  const trips = new Set(mine.flatMap((e) => e.trips))
  return (
    <div className="detail">
      <div className="detail-top">
        <button className="back" onClick={onBack}>← {backLabel}</button>
      </div>
      <header className="detail-h">
        <div className="kicker">城市</div>
        <h2>{areaName(id)}</h2>
        <div className="byline"><span>连着 {mine.length} 个城市</span><span>{trips.size} 篇帖子进出这里</span></div>
      </header>
      <Section title="从这里出发">
        <ol className="plist elist flush">
          {mine.map((e) => {
            const other = e.a === id ? e.b : e.a
            return (
              <li key={e.key}>
                <button onClick={() => onEdge(e.key)} onMouseEnter={() => onHoverEdge(e.key)} onMouseLeave={() => onHoverEdge(null)}>
                  <span className="pl-name">
                    → {areaName(other)}
                    <small>{e.modes.length ? e.modes.slice(0, 4).map(([m]) => MODE_LABEL[m]).join(' · ') : '没有帖子写怎么走'}</small>
                  </span>
                  <span className="pl-n">{e.trips.length}<small> 篇</small></span>
                  <span className="pl-notes">
                    {e.notes.some((n) => n.tone === 'warn') && <span><ToneMark tone="warn" />{e.notes.filter((n) => n.tone === 'warn').length}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </Section>
    </div>
  )
}

/** 城际图层里打开一篇帖子：只看它怎么在城市之间移动 */
export function TransitTrip({ t, onBack, backLabel, onEdge, onHoverEdge, onFull }: {
  t: Trip
  onBack: () => void
  backLabel: string
  onEdge: (key: string) => void
  onHoverEdge: (key: string | null) => void
  onFull: () => void
}) {
  const x = tripTransit.get(t.id)!
  // 每次跨城市移动，配上这篇写的走法（同一对城市、优先同一天）
  const rows = useMemo(() => {
    const used = new Set<Leg>()
    const key = (p: string, q: string) => [p, q].sort().join('~')
    const out: { hop: Hop | null; legs: Leg[]; key: string }[] = x.hops.map((h) => {
      const k = key(h.from, h.to)
      const cand = x.legs.filter((l) => !used.has(l) && key(...l.between) === k)
      const same = cand.filter((l) => l.day == null || l.day === h.day)
      const pick = same.length ? same : cand.slice(0, 1)
      pick.forEach((l) => used.add(l))
      return { hop: h, legs: pick, key: k }
    })
    for (const l of x.legs) if (!used.has(l)) out.push({ hop: null, legs: [l], key: key(...l.between) })
    return out
  }, [x])

  return (
    <div className="detail">
      <div className="detail-top">
        <button className="back" onClick={onBack}>← {backLabel}</button>
        <button className="link small" onClick={onFull}>看完整帖子（城市内图层）</button>
      </div>
      <header className="detail-h">
        <div className="kicker">{KIND_LABEL[t.kind]}{t.days ? ` · ${t.days} 天` : ''}{t.when ? ` · ${t.when}` : ''}</div>
        <h2 className="h-sm">{t.src.title}</h2>
        <div className="byline">
          <span>{t.src.author}</span>
          <span>藏 {fmtCount(t.src.counts.collected)}</span>
          <a href={t.src.url} target="_blank" rel="noreferrer">小红书原帖 ↗</a>
        </div>
        {x.chain.length > 1 && <p className="chain-lg"><Chain chain={x.chain} /></p>}
      </header>

      {rows.length > 0 && (
        <Section title="城际移动" aside={<span className="aside">点一段在地图上查看</span>}>
          <ol className="hops">
            {rows.map((r, k) => (
              <li key={k} onMouseEnter={() => onHoverEdge(r.key)} onMouseLeave={() => onHoverEdge(null)}>
                <button className="hop-h" onClick={() => onEdge(r.key)}>
                  {r.hop ? <>
                    <b>{areaName(r.hop.from)} → {areaName(r.hop.to)}</b>
                    {r.hop.day != null && <span className="leg-day">D{r.hop.day}</span>}
                  </> : <b>{areaName(r.legs[0].between[0])} → {areaName(r.legs[0].between[1])}</b>}
                </button>
                {r.legs.length > 0
                  ? r.legs.map((l, j) => <LegBlock key={j} l={l} showEnds={false} />)
                  : <p className="muted small">{r.hop?.move ? `当天交通：${r.hop.move}` : '没写怎么走'}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {x.tips.length > 0 && (
        <Section title="交通建议">
          <ul className="notes">
            {x.tips.map((tp, k) => (
              <li key={k} className="note note-info">
                <span className="tone tone-info" aria-label={TONE_LABEL.info}>·</span>
                <div>
                  <p>{tp.text}</p>
                  <div className="note-meta"><span>{tp.topic}</span>{tp.from === 'comment' && <span>评论区</span>}</div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {rows.length === 0 && x.tips.length === 0 && <p className="empty">这篇没有城际交通的内容。</p>}
    </div>
  )
}
