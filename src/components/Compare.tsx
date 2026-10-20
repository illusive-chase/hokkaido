import { useMemo } from 'react'
import { areaById, areas, fmtCount, placeAgg, placeById, regions } from '../data'
import type { Trip } from '../types'
import { ToneMark } from './bits'

const SLOT = ['A', 'B', 'C']

/** 并排对比：每列一条行程，行是天；下面是区域覆盖矩阵和共同 / 独有地点 */
export default function Compare({ list, colors, onRemove, onTrip, onPlace, onHoverPlace, onClose }: {
  list: Trip[]
  colors: string[]
  onRemove: (id: string) => void
  onTrip: (id: string) => void
  onPlace: (id: string) => void
  onHoverPlace: (id: string | null) => void
  onClose: () => void
}) {
  const maxDays = Math.max(...list.map((t) => t.plan?.length ?? 0))

  const areaRows = useMemo(() => {
    const used = areas.filter((a) => list.some((t) => [...t.route].some((p) => placeById.get(p)?.area === a.id)))
    return used.map((a) => ({
      area: a,
      cells: list.map((t) => {
        const days = (t.plan ?? []).filter((d) => [...d.stops, d.stay].some((p) => p && placeById.get(p)?.area === a.id)).length
        const stay = (t.plan ?? []).filter((d) => d.stay && (placeById.get(d.stay)?.area === a.id || d.stay === a.id)).length
        return { days, stay }
      }),
    }))
  }, [list])

  const sights = (t: Trip) => new Set(t.route.filter((p) => { const k = placeById.get(p)?.kind; return k === 'sight' || k === 'town' }))
  const shared = useMemo(() => {
    if (list.length < 2) return []
    const sets = list.map(sights)
    return [...sets[0]].filter((p) => sets.every((s) => s.has(p)))
  }, [list])
  const only = useMemo(() => list.map((t, k) => {
    const others = list.filter((_, j) => j !== k).map(sights)
    return [...sights(t)].filter((p) => others.every((s) => !s.has(p)))
  }), [list])

  return (
    <div className="compare">
      <header className="cmp-h">
        <h2>路线对比</h2>
        <span className="aside">{list.length < 2 ? '再选一条行程加入对比' : '地图上用颜色区分；悬停地点名会在地图上高亮'}</span>
        <button className="link" onClick={onClose}>收起</button>
      </header>

      <div className="cmp-grid" style={{ gridTemplateColumns: `3.2rem repeat(${list.length}, minmax(0, 1fr))` }}>
        <div />
        {list.map((t, k) => (
          <div key={t.id} className="cmp-col-h" style={{ ['--c' as string]: colors[k] }}>
            <div className="cmp-slot"><i />{SLOT[k]}<button className="link" onClick={() => onRemove(t.id)} aria-label="移出对比">移出</button></div>
            <button className="link cmp-title" onClick={() => onTrip(t.id)}>{t.src.title}</button>
            <div className="cmp-meta">
              {t.days ? `${t.days} 天 · ` : ''}{t.src.author} · 藏 {fmtCount(t.src.counts.collected)}
            </div>
            <div className="cmp-meta">
              {placeById.get(t.in ?? '')?.name ?? '—'} 进 · {placeById.get(t.out ?? '')?.name ?? '—'} 出
            </div>
            <div className="cmp-meta">住：{t.bases.map((b) => areaById.get(b)?.name).join(' → ') || '—'}</div>
          </div>
        ))}

        {Array.from({ length: maxDays }, (_, r) => (
          <div key={r} className="cmp-row">
            <div className="cmp-day">{r + 1}</div>
            {list.map((t) => {
              const d = t.plan?.[r]
              return (
                <div key={t.id} className="cmp-cell">
                  {d ? (
                    <>
                      <p>{d.label ?? `D${d.day}`}<span className="cmp-sep">·</span>{d.title}</p>
                      <div className="cmp-stops">
                        {d.stops.filter((s, j) => d.stops.indexOf(s) === j).map((s) => (
                          <button key={s} className={`stop stop-${placeById.get(s)?.kind}`} onClick={() => onPlace(s)} onMouseEnter={() => onHoverPlace(s)} onMouseLeave={() => onHoverPlace(null)}>
                            {placeById.get(s)?.name}
                            {placeAgg.get(s)?.notes.some((n) => n.trip === t.id && n.tone === 'warn') && <ToneMark tone="warn" />}
                          </button>
                        ))}
                      </div>
                      {d.stay && <div className="cmp-stay">宿 {placeById.get(d.stay)?.name}</div>}
                    </>
                  ) : <span className="muted">—</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="cmp-lower">
        <section>
          <h3>区域覆盖（天数）</h3>
          <table className="cov">
            <thead>
              <tr><th />{list.map((t, k) => <th key={t.id} style={{ color: colors[k] }}>{SLOT[k]}</th>)}</tr>
            </thead>
            <tbody>
              {regions.map((rg) => areaRows.filter((r) => r.area.region === rg.id).map((r, j) => (
                <tr key={r.area.id} className={j === 0 ? 'rg-first' : ''}>
                  <th>{r.area.name}</th>
                  {r.cells.map((c, k) => (
                    <td key={k}>
                      {c.days > 0 ? (
                        <span className="cov-cell" style={{ ['--c' as string]: colors[k], ['--a' as string]: Math.min(1, 0.25 + c.days * 0.2) }}>
                          {c.days}{c.stay > 0 && <small>宿{c.stay}</small>}
                        </span>
                      ) : <span className="muted">·</span>}
                    </td>
                  ))}
                </tr>
              )))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>景点异同</h3>
          {list.length > 1 && (
            <div className="diff">
              <h4>都去了</h4>
              <div className="stops">{shared.length ? shared.map((p) => <button key={p} className="stop" onClick={() => onPlace(p)}>{placeById.get(p)?.name}</button>) : <span className="muted small">没有共同景点</span>}</div>
            </div>
          )}
          {list.map((t, k) => (
            <div key={t.id} className="diff">
              <h4 style={{ color: colors[k] }}>只有 {SLOT[k]}</h4>
              <div className="stops">{only[k].map((p) => <button key={p} className="stop" onClick={() => onPlace(p)}>{placeById.get(p)?.name}</button>)}</div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
