import type { Area, Place, PlaceAgg, Region, Trip, TripAnno } from './types'
import { atlas } from './vault'

// atlas/ 的数据在解锁以后才有（见 src/vault.ts），这个模块要等解锁以后再加载
const { areas: areasJson, places: placeFiles, trips: tripFiles, sources } = atlas()

export const regions: Region[] = areasJson.regions
export const areas: Area[] = areasJson.areas
export const themes: string[] = areasJson.themes
export const areaById = new Map(areas.map((a) => [a.id, a]))

export const places: Place[] = Object.values(placeFiles).flat()
export const placeById = new Map(places.map((p) => [p.id, p]))

const regionOf = (placeId: string) => areaById.get(placeById.get(placeId)?.area ?? '')?.region ?? null

function buildTrip(id: string, a: TripAnno): Trip {
  const route: string[] = []
  const seen = new Set<string>()
  const push = (p?: string) => { if (p && !seen.has(p)) { seen.add(p); route.push(p) } }
  const segments = (a.plan ?? []).map((d) => {
    const ids = [...d.stops]
    if (d.stay && ids[ids.length - 1] !== d.stay) ids.push(d.stay)
    ids.forEach(push)
    return { day: d.day, ids }
  })
  push(a.in)
  push(a.out)
  const mentions = new Set<string>(route)
  for (const n of a.notes ?? []) mentions.add(n.place)
  for (const p of a.photos ?? []) mentions.add(p.place)
  for (const r of a.ratings ?? []) mentions.add(r.place)
  const areasSet = new Set<string>()
  const regionsSet = new Set<string>()
  for (const p of mentions) {
    const pl = placeById.get(p)
    if (!pl) continue
    areasSet.add(pl.area)
    const r = regionOf(p)
    if (r) regionsSet.add(r)
  }
  const photoPlace = new Map<number, string>()
  for (const ph of a.photos ?? []) for (const i of ph.img) photoPlace.set(i, ph.place)
  return { ...a, id, src: sources[id], route, segments, mentions, areas: areasSet, regions: regionsSet, photoPlace }
}

export const trips: Trip[] = Object.entries(tripFiles)
  .map(([id, a]) => buildTrip(id, a))
  .filter((t) => t.src)
  .sort((x, y) => y.src.counts.collected - x.src.counts.collected)
export const tripById = new Map(trips.map((t) => [t.id, t]))

export const placeAgg = new Map<string, PlaceAgg>()
for (const p of places) placeAgg.set(p.id, { place: p, visits: [], notes: [], photos: [], ratings: [] })
for (const t of trips) {
  for (const id of t.mentions) {
    const agg = placeAgg.get(id)
    if (!agg) continue
    const days = (t.plan ?? []).filter((d) => d.stops.includes(id) || d.stay === id).map((d) => d.day)
    agg.visits.push({ trip: t.id, days, role: t.route.includes(id) ? 'route' : 'mention' })
  }
  for (const n of t.notes ?? []) placeAgg.get(n.place)?.notes.push({ ...n, trip: t.id })
  for (const ph of t.photos ?? []) for (const img of ph.img) placeAgg.get(ph.place)?.photos.push({ trip: t.id, img })
  for (const r of t.ratings ?? []) placeAgg.get(r.place)?.ratings.push({ ...r, trip: t.id })
}

/** local/ 里的图片和原文（npm run data 生成），用 src/vault.ts 的 mediaUrl / localFile 读 */
export const pad2 = (i: number) => String(i).padStart(2, '0')
export const imgPath = (trip: string, i: number) => `img/${trip}/${pad2(i)}.jpg`
export const thumbPath = (trip: string, i: number) => `thumb/${trip}/${pad2(i)}.jpg`
export const textPath = (trip: string) => `text/${trip}.json`

export const KIND_LABEL: Record<Trip['kind'], string> = {
  itinerary: '多日行程',
  daytrip: '一日游',
  pilgrimage: '巡礼',
  guide: '经验',
  review: '点评',
  question: '提问',
}

export const PLACE_KIND_LABEL: Record<Place['kind'], string> = {
  town: '城镇', sight: '景点', station: '车站', airport: '机场', food: '餐饮', stay: '住宿',
}

export const TONE_LABEL = { good: '推荐', warn: '注意', meh: '一般', info: '信息' } as const

/** 城市内图层的四类元素，可以分别开关 */
export type Elem = 'sight' | 'food' | 'transport' | 'stay'
export const ELEMS: Elem[] = ['sight', 'food', 'transport', 'stay']
export const ELEM_LABEL: Record<Elem, string> = { sight: '景点', food: '饮食', transport: '交通', stay: '住宿' }
export const elemOf = (k: Place['kind']): Elem =>
  k === 'food' ? 'food' : k === 'stay' ? 'stay' : k === 'station' || k === 'airport' ? 'transport' : 'sight'

export function fmtCount(n: number) {
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + '万'
  return String(n)
}

export function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const MAX_DAYS = Math.max(...trips.map((t) => t.days ?? 0))
