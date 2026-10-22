import { areaById, placeAgg, placeById, trips } from './data'
import type { EdgeAgg, Leg, LegNote, Tip, TransitMode, Trip, TripLeg } from './types'

type LngLat = [number, number]

export const MODE_LABEL: Record<TransitMode, string> = {
  jr: 'JR', bus: '巴士', shuttle: '接驳车', car: '自驾', charter: '包车/拼车', tour: '一日游团', flight: '飞机', taxi: '打车',
  tram: '市电', subway: '地铁', ropeway: '缆车',
}
/** 帖子里写城际交通用的方式（城际图层的筛选）；市电、地铁、缆车只在建议路线里用 */
export const MODES: TransitMode[] = ['jr', 'bus', 'shuttle', 'car', 'charter', 'tour', 'flight', 'taxi']

/** 这些话题的通用建议算「交通」，在城际图层显示 */
export const TRANSIT_TOPICS = new Set(['交通', '机票'])

export const edgeKey = (x: string, y: string) => (x < y ? `${x}~${y}` : `${y}~${x}`)
export const areaName = (id: string) => areaById.get(id)?.name ?? id

/** 区域在地图上的代表点：城镇 > 机场 > 车站 > 所有地点的平均 */
export const areaAnchor = new Map<string, LngLat>()
{
  const byArea = new Map<string, { at: LngLat; kind: string }[]>()
  for (const { place } of placeAgg.values()) {
    // 北海道以外的地点只在建议路线里画，不进城际和城市内图层
    if (place.offmap || !areaById.get(place.area)?.region) continue
    byArea.set(place.area, [...(byArea.get(place.area) ?? []), place])
  }
  for (const [a, list] of byArea) {
    const pick = ['town', 'airport', 'station'].map((k) => list.find((p) => p.kind === k)).find(Boolean)
    areaAnchor.set(a, pick ? pick.at : [list.reduce((s, p) => s + p.at[0], 0) / list.length, list.reduce((s, p) => s + p.at[1], 0) / list.length])
  }
}

/** 行程里的一次跨区域移动，day 是到达那天 */
export interface Hop { from: string; to: string; day: number | null; move?: string }

/** 按行程顺序经过的区域（相邻去重、去掉地图外的），拆成一次次跨区域移动 */
export function hopsOf(t: Trip): Hop[] {
  const seq: { area: string; day: number | null }[] = []
  const push = (id: string | undefined, day: number | null) => {
    const p = id ? placeById.get(id) : null
    if (!p || p.offmap) return
    if (seq[seq.length - 1]?.area !== p.area) seq.push({ area: p.area, day })
  }
  const plan = t.plan ?? []
  push(t.in, plan[0]?.day ?? null)
  for (const s of t.segments) for (const id of s.ids) push(id, s.day)
  push(t.out, plan[plan.length - 1]?.day ?? null)
  const out: Hop[] = []
  for (let i = 1; i < seq.length; i++) {
    const day = seq[i].day
    out.push({ from: seq[i - 1].area, to: seq[i].area, day, move: plan.find((d) => d.day === day)?.move })
  }
  return out
}

export interface TripTransit {
  /** 经过的区域，按顺序 */
  chain: string[]
  hops: Hop[]
  legs: Leg[]
  tips: Tip[]
  modes: TransitMode[]
  /** 涉及的路段 */
  edges: Set<string>
}

export const tripTransit = new Map<string, TripTransit>()
for (const t of trips) {
  const hops = hopsOf(t)
  const legs = (t.legs ?? []).filter((l) => areaAnchor.has(l.between[0]) && areaAnchor.has(l.between[1]) && l.between[0] !== l.between[1])
  const chain = hops.length ? [hops[0].from, ...hops.map((h) => h.to)] : []
  const modes = [...new Set(legs.flatMap((l) => l.mode ?? []))]
  const edges = new Set([...hops.map((h) => edgeKey(h.from, h.to)), ...legs.map((l) => edgeKey(...l.between))])
  tripTransit.set(t.id, { chain, hops, legs, tips: (t.tips ?? []).filter((x) => TRANSIT_TOPICS.has(x.topic)), modes, edges })
}

export const hasTransit = (t: Trip) => {
  const x = tripTransit.get(t.id)!
  return x.legs.length > 0 || x.tips.length > 0 || x.chain.length > 1
}

export interface EdgeView extends EdgeAgg {
  /** 行程经过、但这篇没有写这段怎么走 */
  routeOnly: { trip: string; hops: Hop[] }[]
  modes: [TransitMode, number][]
  notes: (LegNote & { trip: string })[]
}

/**
 * 城际图层的边：只统计给定的帖子。
 * 给了 modes 时只算用了这些交通方式的方案，行程里「只是经过」的不算
 */
export function buildEdges(list: Trip[], modes?: Set<TransitMode>): Map<string, EdgeView> {
  const byMode = !!modes?.size
  const m = new Map<string, EdgeView>()
  const get = (x: string, y: string) => {
    const key = edgeKey(x, y)
    let e = m.get(key)
    if (!e) {
      const [a, b] = x < y ? [x, y] : [y, x]
      e = { key, a, b, legs: [], trips: [], routeOnly: [], modes: [], notes: [] }
      m.set(key, e)
    }
    return e
  }
  for (const t of list) {
    const x = tripTransit.get(t.id)!
    const covered = new Set<string>()
    for (const l of x.legs) {
      if (byMode && !l.mode?.some((md) => modes!.has(md))) continue
      const e = get(...l.between)
      e.legs.push({ ...l, trip: t.id } as TripLeg)
      for (const n of l.notes ?? []) e.notes.push({ ...n, trip: t.id })
      covered.add(e.key)
      if (!e.trips.includes(t.id)) e.trips.push(t.id)
    }
    const byEdge = new Map<string, Hop[]>()
    for (const h of byMode ? [] : x.hops) {
      const e = get(h.from, h.to)
      if (!e.trips.includes(t.id)) e.trips.push(t.id)
      if (!covered.has(e.key)) byEdge.set(e.key, [...(byEdge.get(e.key) ?? []), h])
    }
    for (const [key, hops] of byEdge) m.get(key)!.routeOnly.push({ trip: t.id, hops })
  }
  for (const e of m.values()) {
    const c = new Map<TransitMode, number>()
    for (const l of e.legs) for (const md of l.mode ?? []) c.set(md, (c.get(md) ?? 0) + 1)
    e.modes = [...c].sort((p, q) => q[1] - p[1])
  }
  return m
}

/** 所有帖子的边，用来校验 URL 里的 edge 参数 */
export const allEdges = buildEdges(trips)

/** 两个区域代表点之间的直线距离（公里） */
export function distanceKm(a: string, b: string) {
  const p = areaAnchor.get(a), q = areaAnchor.get(b)
  if (!p || !q) return null
  const r = Math.PI / 180
  const h = Math.sin(((q[1] - p[1]) * r) / 2) ** 2 + Math.cos(p[1] * r) * Math.cos(q[1] * r) * Math.sin(((q[0] - p[0]) * r) / 2) ** 2
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)))
}
