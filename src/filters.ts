import { areaById, elemOf, placeAgg, placeById, trips, type Elem } from './data'
import { hasTransit, tripTransit } from './transit'
import type { Place, TransitMode, Trip, TripKind } from './types'

export type DaysBucket = 'any' | 'short' | 'mid' | 'long'
export type TripSort = 'collected' | 'recent' | 'days'

export interface TripFilter {
  kinds: Set<TripKind>
  regions: Set<string>
  days: DaysBucket
  q: string
  sort: TripSort
}

export const DAYS_LABEL: Record<DaysBucket, string> = { any: '不限', short: '1–3 天', mid: '4–6 天', long: '7 天以上' }

const inBucket = (t: Trip, b: DaysBucket) => {
  if (b === 'any') return true
  if (!t.days) return false
  if (b === 'short') return t.days <= 3
  if (b === 'mid') return t.days >= 4 && t.days <= 6
  return t.days >= 7
}

function haystack(t: Trip) {
  const names = [...t.mentions].map((id) => placeById.get(id)?.name ?? '').join(' ')
  return [t.src.title, t.summary, t.src.author, (t.style ?? []).join(' '), t.src.tags.join(' '), names, t.when ?? ''].join(' ').toLowerCase()
}
const hay = new Map(trips.map((t) => [t.id, haystack(t)]))

export function filterTrips(f: TripFilter): Trip[] {
  const q = f.q.trim().toLowerCase()
  const out = trips.filter((t) =>
    (f.kinds.size === 0 || f.kinds.has(t.kind)) &&
    [...f.regions].every((r) => t.regions.has(r)) &&
    inBucket(t, f.days) &&
    (!q || q.split(/\s+/).every((w) => hay.get(t.id)!.includes(w))),
  )
  if (f.sort === 'recent') out.sort((a, b) => b.src.publishTime.localeCompare(a.src.publishTime))
  else if (f.sort === 'days') out.sort((a, b) => (b.days ?? 0) - (a.days ?? 0) || b.src.counts.collected - a.src.counts.collected)
  return out
}

export interface PlaceFilter {
  theme: string | null
  regions: Set<string>
  q: string
}

export interface PlaceRow { place: Place; n: number; notes: number; good: number; warn: number }

export function filterPlaces(f: PlaceFilter, elems: Set<Elem>, within: Trip[], regionOf: (p: Place) => string | null): PlaceRow[] {
  const ids = new Set(within.map((t) => t.id))
  const q = f.q.trim().toLowerCase()
  const rows: PlaceRow[] = []
  for (const agg of placeAgg.values()) {
    const p = agg.place
    if (p.offmap) continue
    if (!elems.has(elemOf(p.kind))) continue
    if (f.theme && !p.themes.includes(f.theme)) continue
    if (f.regions.size && !f.regions.has(regionOf(p) ?? '')) continue
    if (q && !`${p.name} ${p.ja ?? ''} ${p.blurb ?? ''}`.toLowerCase().includes(q)) continue
    const n = agg.visits.filter((v) => ids.has(v.trip)).length
    if (n === 0) continue
    const notes = agg.notes.filter((x) => ids.has(x.trip))
    rows.push({
      place: p,
      n,
      notes: notes.length,
      good: notes.filter((x) => x.tone === 'good').length,
      warn: notes.filter((x) => x.tone === 'warn' || x.tone === 'meh').length,
    })
  }
  rows.sort((a, b) => b.n - a.n || b.notes - a.notes)
  return rows
}

// —— 城际图层 ——

export interface TransitFilter {
  q: string
  modes: Set<TransitMode>
  regions: Set<string>
}

function transitHaystack(t: Trip) {
  const x = tripTransit.get(t.id)!
  const names = x.chain.map((a) => areaById.get(a)?.name ?? '').join(' ')
  const legs = x.legs.map((l) => [l.how, l.time, l.cost, ...(l.notes ?? []).map((n) => n.text)].join(' ')).join(' ')
  return [t.src.title, t.src.author, names, legs, x.tips.map((tp) => tp.text).join(' ')].join(' ').toLowerCase()
}
const transitHay = new Map(trips.map((t) => [t.id, transitHaystack(t)]))

/** 城际图层只列出有交通内容的帖子：经过两个以上区域，或者写了怎么走、交通建议 */
export const transitTrips = trips.filter(hasTransit)

export function filterTransit(f: TransitFilter): Trip[] {
  const q = f.q.trim().toLowerCase()
  return transitTrips.filter((t) => {
    const x = tripTransit.get(t.id)!
    return (f.modes.size === 0 || x.modes.some((m) => f.modes.has(m))) &&
      [...f.regions].every((r) => t.regions.has(r)) &&
      (!q || q.split(/\s+/).every((w) => transitHay.get(t.id)!.includes(w)))
  })
}
