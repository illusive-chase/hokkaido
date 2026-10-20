import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import { elemOf, placeAgg, placeById, type Elem } from '../data'
import { areaAnchor, type EdgeView } from '../transit'
import { ALT_META, altAnchor, altsOf, mainStops, SLOT_LABEL } from '../plan'
import type { SgPlan, Trip } from '../types'

type LngLat = [number, number]
const onMap = (id: string) => { const p = placeById.get(id); return p && !p.offmap ? p : null }

/** 把一条行程的每天拼成一串地点，去掉相邻重复和地图外的地点（例如东京） */
export function legs(trip: Trip): [string, string][] {
  const seq: string[] = []
  for (const s of trip.segments) for (const id of s.ids) if (onMap(id) && seq[seq.length - 1] !== id) seq.push(id)
  if (trip.in && onMap(trip.in) && seq[0] !== trip.in) seq.unshift(trip.in)
  const out: [string, string][] = []
  for (let i = 1; i < seq.length; i++) out.push([seq[i - 1], seq[i]])
  return out
}

/** 两点之间画一条弧线：弧度和长度成正比，bend 控制弯曲方向和程度 */
export function arc(a: LngLat, b: LngLat, bend = 0.14, n = 24): LngLat[] {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180) // 经度按纬度压缩，弧线在地图上才是对称的
  const dx = (b[0] - a[0]) * k
  const dy = b[1] - a[1]
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const cx = mx + (-dy * bend) / k
  const cy = my + dx * bend
  const pts: LngLat[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    pts.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]])
  }
  return pts
}

/** 城市内图层的「走廊」：同一区域里两个地点之间被几篇（筛选后的）行程连着走过。跨区域的移动交给城际图层 */
export function corridors(trips: Trip[]): FeatureCollection<LineString> {
  const count = new Map<string, number>()
  for (const t of trips) {
    const seen = new Set<string>()
    for (const [a, b] of legs(t)) {
      if (placeById.get(a)!.area !== placeById.get(b)!.area) continue
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      if (seen.has(key)) continue
      seen.add(key)
      count.set(key, (count.get(key) ?? 0) + 1)
    }
  }
  const features: Feature<LineString>[] = []
  for (const [key, c] of count) {
    const [a, b] = key.split('|')
    features.push({
      type: 'Feature',
      properties: { count: c },
      geometry: { type: 'LineString', coordinates: arc(placeById.get(a)!.at, placeById.get(b)!.at, 0.12) },
    })
  }
  features.sort((x, y) => (x.properties!.count as number) - (y.properties!.count as number))
  return { type: 'FeatureCollection', features }
}

export interface RouteSpec { trip: Trip; color: string; bend: number; width: number; dash?: boolean }

export function routes(specs: RouteSpec[]): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const s of specs) {
    for (const [a, b] of legs(s.trip)) {
      features.push({
        type: 'Feature',
        properties: { color: s.color, width: s.width },
        geometry: { type: 'LineString', coordinates: arc(placeById.get(a)!.at, placeById.get(b)!.at, s.bend) },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

export interface PlacePointOpts {
  trips: Trip[]
  elems: Set<Elem>
  activePlaces: Set<string> | null
  highlight: Map<string, string>
  selected: string | null
}

/** 地点：景点的大小按「被几篇（筛选后的）帖子提到」；饮食、交通、住宿用固定大小的图标 */
export function placePoints(o: PlacePointOpts): FeatureCollection<Point> {
  const tripIds = new Set(o.trips.map((t) => t.id))
  const features: Feature<Point>[] = []
  for (const [id, agg] of placeAgg) {
    const p = agg.place
    if (p.offmap) continue
    const elem = elemOf(p.kind)
    const hl = o.highlight.get(id)
    // 关掉的元素不画；但正在看的行程经过它、或者选中了它，还是要画出来
    if (!o.elems.has(elem) && !hl && o.selected !== id) continue
    const n = agg.visits.filter((v) => tripIds.has(v.trip)).length
    const total = agg.visits.length
    if (total === 0) continue
    const active = o.activePlaces ? o.activePlaces.has(id) : n > 0
    features.push({
      type: 'Feature',
      properties: {
        id,
        name: p.name,
        n,
        total,
        elem,
        shop: elem !== 'sight',
        active,
        hl: hl ?? '',
        sel: o.selected === id,
        rank: (hl ? 1000 : 0) + (o.selected === id ? 2000 : 0) + n,
      },
      geometry: { type: 'Point', coordinates: p.at },
    })
  }
  features.sort((a, b) => (a.properties!.rank as number) - (b.properties!.rank as number))
  return { type: 'FeatureCollection', features }
}

export function boundsOf(ids: Iterable<string>): [LngLat, LngLat] | null {
  return boundsOfPts([...ids].map((id) => onMap(id)?.at).filter((x): x is LngLat => !!x))
}

export function boundsOfPts(pts: LngLat[]): [LngLat, LngLat] | null {
  if (!pts.length) return null
  let w = 180, s = 90, e = -180, n = -90
  for (const [x, y] of pts) {
    w = Math.min(w, x); e = Math.max(e, x)
    s = Math.min(s, y); n = Math.max(n, y)
  }
  return [[w, s], [e, n]]
}

/** 城市内图层的总览：按区域聚合的点，大小按经过它的帖子数 */
export function areaPoints(trips: Trip[], names: Map<string, string>): FeatureCollection<Point> {
  const count = new Map<string, number>()
  for (const t of trips) {
    // 机场只是中转，不计入区域热度
    const seen = new Set([...t.mentions].filter((id) => placeById.get(id)?.kind !== 'airport').map((id) => placeById.get(id)?.area))
    for (const a of seen) if (a) count.set(a, (count.get(a) ?? 0) + 1)
  }
  const features: Feature<Point>[] = []
  for (const [a, at] of areaAnchor) {
    const n = count.get(a) ?? 0
    features.push({ type: 'Feature', properties: { id: a, name: names.get(a) ?? a, n }, geometry: { type: 'Point', coordinates: at } })
  }
  features.sort((x, y) => (x.properties!.n as number) - (y.properties!.n as number))
  return { type: 'FeatureCollection', features }
}

// —— 城际图层 ——

export interface NetOpts {
  /** 选中的路段 */
  edge: string | null
  /** 高亮的路段（悬停、打开的帖子、选中的城市）；有高亮时其余路段变淡 */
  hl: Set<string>
  hover: string | null
}

/** 城际图层的边：粗细按经过的帖子数；有没有写「怎么走」分开画 */
export function netEdges(edges: Iterable<EdgeView>, o: NetOpts): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const e of edges) {
    const pa = areaAnchor.get(e.a), pb = areaAnchor.get(e.b)
    if (!pa || !pb) continue
    const lit = e.key === o.edge || e.key === o.hover || o.hl.has(e.key)
    features.push({
      type: 'Feature',
      properties: {
        key: e.key,
        a: e.a,
        b: e.b,
        count: e.trips.length,
        legs: new Set(e.legs.map((l) => l.trip)).size,
        warn: e.notes.filter((n) => n.tone === 'warn').length,
        sel: e.key === o.edge,
        lit,
        dim: (o.hl.size > 0 || !!o.edge) && !lit,
      },
      geometry: { type: 'LineString', coordinates: arc(pa, pb, 0.1) },
    })
  }
  features.sort((x, y) => Number(x.properties!.lit) - Number(y.properties!.lit) || (x.properties!.count as number) - (y.properties!.count as number))
  return { type: 'FeatureCollection', features }
}

/** 城际图层的城市：大小按经过它的帖子数 */
export function netNodes(edges: Iterable<EdgeView>, names: Map<string, string>, o: { city: string | null; lit: Set<string> }): FeatureCollection<Point> {
  const trips = new Map<string, Set<string>>()
  for (const e of edges) for (const a of [e.a, e.b]) {
    const s = trips.get(a) ?? new Set<string>()
    e.trips.forEach((t) => s.add(t))
    trips.set(a, s)
  }
  const features: Feature<Point>[] = []
  for (const [a, s] of trips) {
    const at = areaAnchor.get(a)
    if (!at) continue
    features.push({
      type: 'Feature',
      properties: { id: a, name: names.get(a) ?? a, n: s.size, sel: o.city === a, lit: o.lit.has(a), dim: o.lit.size > 0 && !o.lit.has(a) },
      geometry: { type: 'Point', coordinates: at },
    })
  }
  features.sort((x, y) => (x.properties!.n as number) - (y.properties!.n as number))
  return { type: 'FeatureCollection', features }
}

// —— 建议路线 ——

export interface PlanGeoOpts {
  /** 选中的一天；null 时看全程 */
  day: number | null
  /** 选中的分支 key */
  alt: string | null
  /** 悬停的地点 */
  hover: string | null
}

/** 主路线：按顺序连起每个地点，跨区域的一段画粗一点；属于选中那天的点亮 */
export function planLines(p: SgPlan, o: PlanGeoOpts): FeatureCollection<LineString> {
  const seq = mainStops(p)
  const features: Feature<LineString>[] = []
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i]
    const cross = placeById.get(a.id)!.area !== placeById.get(b.id)!.area
    const lit = o.day == null || b.day === o.day
    features.push({
      type: 'Feature',
      properties: { day: b.day, cross, lit, dim: o.day != null && !lit },
      geometry: { type: 'LineString', coordinates: arc(a.at, b.at, cross ? 0.1 : 0.16) },
    })
  }
  features.sort((x, y) => Number(x.properties!.lit) - Number(y.properties!.lit))
  return { type: 'FeatureCollection', features }
}

/** 分支：从时段之前最后经过的地点接出去，依次连起分支里的地点 */
export function planAlts(p: SgPlan, o: PlanGeoOpts): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const r of altsOf(p)) {
    const from = altAnchor(p, r)
    const pts = r.alt.stops.map((id) => onMap(id)?.at).filter((x): x is LngLat => !!x)
    if (from) pts.unshift(from)
    const sel = r.key === o.alt
    const lit = sel || r.day.day === o.day
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1][0] === pts[i][0] && pts[i - 1][1] === pts[i][1]) continue
      features.push({
        type: 'Feature',
        properties: { key: r.key, day: r.day.day, kind: r.alt.kind, sel, lit, dim: o.day != null && !lit },
        geometry: { type: 'LineString', coordinates: arc(pts[i - 1], pts[i], -0.2) },
      })
    }
  }
  features.sort((x, y) => Number(x.properties!.lit) + Number(x.properties!.sel) - Number(y.properties!.lit) - Number(y.properties!.sel))
  return { type: 'FeatureCollection', features }
}

/** 路线上的地点（住处单独画）：选中那天的点放大并标名字；选中分支的地点也画出来 */
export function planStops(p: SgPlan, o: PlanGeoOpts): FeatureCollection<Point> {
  const features: Feature<Point>[] = []
  const seen = new Set<string>()
  const stays = new Set(p.days.map((d) => d.stay).filter(Boolean))
  for (const d of p.days) {
    for (const s of d.slots) {
      for (const id of s.stops) {
        const pl = onMap(id)
        const k = `${id}|${d.day}`
        if (!pl || seen.has(k) || stays.has(id)) continue
        seen.add(k)
        const lit = d.day === o.day || id === o.hover
        features.push({
          type: 'Feature',
          properties: { id, name: pl.name, day: d.day, when: `D${d.day} · ${SLOT_LABEL[s.slot]}`, alt: false, lit, label: lit, rank: lit ? 1 : 0 },
          geometry: { type: 'Point', coordinates: pl.at },
        })
      }
    }
  }
  for (const r of altsOf(p)) {
    if (r.key !== o.alt && r.day.day !== o.day) continue
    for (const id of r.alt.stops) {
      const pl = onMap(id)
      if (!pl || seen.has(`${id}|${r.day.day}`)) continue
      seen.add(`${id}|${r.day.day}`)
      const sel = r.key === o.alt
      features.push({
        type: 'Feature',
        properties: { id, name: pl.name, day: r.day.day, when: `D${r.day.day} 备选 · ${ALT_META[r.alt.kind].label}`, alt: true, lit: sel, label: sel || id === o.hover, rank: sel ? 2 : 0 },
        geometry: { type: 'Point', coordinates: pl.at },
      })
    }
  }
  features.sort((x, y) => (x.properties!.rank as number) - (y.properties!.rank as number))
  return { type: 'FeatureCollection', features }
}

/** 住处：连住的几晚合成一个标记（「1–2」），再加上进出的机场 */
export function planStays(p: SgPlan, o: PlanGeoOpts, areaNames: Map<string, string>): FeatureCollection<Point> {
  const features: Feature<Point>[] = []
  let k = 0
  while (k < p.days.length) {
    const id = p.days[k].stay
    if (!id) { k++; continue }
    let j = k
    while (j + 1 < p.days.length && p.days[j + 1].stay === id) j++
    const pl = onMap(id)
    if (pl) {
      const first = p.days[k].day, last = p.days[j].day
      const lit = o.day == null || (o.day >= first && o.day <= last + 1)
      features.push({
        type: 'Feature',
        properties: {
          id, kind: 'stay', mark: first === last ? String(first) : `${first}–${last}`,
          name: `${areaNames.get(pl.area) ?? pl.name} · ${last - first + 1} 晚`, day: first, lit, dim: !lit,
        },
        geometry: { type: 'Point', coordinates: pl.at },
      })
    }
    k = j + 1
  }
  for (const [id, mark, day] of [[p.in, '进', p.days[0].day], [p.out, '出', p.days[p.days.length - 1].day]] as const) {
    const pl = onMap(id)
    if (!pl) continue
    const lit = o.day == null || o.day === day
    features.push({ type: 'Feature', properties: { id, kind: 'end', mark, name: pl.name, day, lit, dim: !lit }, geometry: { type: 'Point', coordinates: pl.at } })
  }
  return { type: 'FeatureCollection', features }
}
