import { placeById, trips } from './data'
import type { AltKind, SgAlt, SgDay, SgPlan, SgRide, SgSlot, SgSlotItem, Trip } from './types'
import { atlas } from './vault'

type LngLat = [number, number]

export const plans: SgPlan[] = Object.entries(atlas().plans).map(([id, p]) => ({ ...p, id }))
export const planById = new Map(plans.map((p) => [p.id, p]))

export const SLOT_LABEL: Record<SgSlot, string> = { am: '上午', pm: '下午', eve: '傍晚' }
export const SLOTS: SgSlot[] = ['am', 'pm', 'eve']

/** 分支的图标和名字：图标和文字一起出现，不只靠颜色区分 */
export const ALT_META: Record<AltKind, { icon: string; label: string }> = {
  snow: { icon: '❄', label: '暴雪·停运' },
  cloud: { icon: '☁', label: '阴天' },
  nosnow: { icon: '◌', label: '没有雪' },
  sunny: { icon: '☀', label: '放晴' },
  makeup: { icon: '↺', label: '补上前几天' },
}

/** 出处写的是帖子 ID 前缀，展开成帖子 */
export function refTrip(prefix: string): Trip | null {
  const hit = trips.filter((t) => t.id.startsWith(prefix))
  return hit.length === 1 ? hit[0] : null
}

/** 分支在 URL 里的写法：天.时段序号.分支序号；整天的分支时段写 d */
export const altKey = (day: number, slot: number | 'd', k: number) => `${day}.${slot}.${k}`

export interface AltRef { key: string; day: SgDay; slot: number | null; alt: SgAlt }

export function altsOf(p: SgPlan): AltRef[] {
  const out: AltRef[] = []
  for (const d of p.days) {
    d.slots.forEach((s, i) => (s.alts ?? []).forEach((alt, k) => out.push({ key: altKey(d.day, i, k), day: d, slot: i, alt })))
    ;(d.alts ?? []).forEach((alt, k) => out.push({ key: altKey(d.day, 'd', k), day: d, slot: null, alt }))
  }
  return out
}

// —— 选了哪些备选 ——
// 每个时段最多选一个，整天的备选会换掉这一天所有时段；几天的选择同时生效。
// 选择用一组 key 表示（URL 里 alt=3.2.0,8.1.0），「位置」是 天.时段 或 天.d。

/** key 所在的位置：「3.2」或「3.d」 */
export const altSpot = (key: string) => key.split('.').slice(0, 2).join('.')
export const altDay = (key: string) => Number(key.split('.')[0])

/** 选中一个备选：同一位置的旧选择换掉；选整天的清掉这天各时段的，选时段的清掉这天整天的。传 null 是恢复原计划 */
export function pickAlt(cur: string[], spot: string, key: string | null): string[] {
  const day = spot.split('.')[0]
  const whole = spot.endsWith('.d')
  const next = cur.filter((k) => {
    if (altSpot(k) === spot) return false
    if (key && altDay(k) === Number(day) && (whole || altSpot(k) === `${day}.d`)) return false
    return true
  })
  return key ? [...next, key].sort() : next
}

/** 这一时段实际走的：原计划，或者选中的备选 */
export interface EffSlot {
  i: number
  slot: SgSlotItem
  /** 选中的备选（时段的或整天的）；null 是原计划 */
  alt: SgAlt | null
  altKey: string | null
  /** 这一时段实际经过的地点 */
  stops: string[]
}
export interface EffDay { d: SgDay; slots: EffSlot[]; dayAlt: SgAlt | null; dayAltKey: string | null }

export function effDay(d: SgDay, picked: Set<string>): EffDay {
  const dk = (d.alts ?? []).findIndex((_, k) => picked.has(altKey(d.day, 'd', k)))
  const dayAlt = dk >= 0 ? d.alts![dk] : null
  const slots = d.slots.map((slot, i): EffSlot => {
    if (dayAlt) return { i, slot, alt: dayAlt, altKey: altKey(d.day, 'd', dk), stops: i === 0 ? dayAlt.stops : [] }
    const k = (slot.alts ?? []).findIndex((_, j) => picked.has(altKey(d.day, i, j)))
    if (k < 0) return { i, slot, alt: null, altKey: null, stops: slot.stops }
    const alt = slot.alts![k]
    return { i, slot, alt, altKey: altKey(d.day, i, k), stops: alt.from ? [alt.from, ...alt.stops] : alt.stops }
  })
  return { d, slots, dayAlt, dayAltKey: dayAlt ? altKey(d.day, 'd', dk) : null }
}

/** 一个地点在路线上的位置：第几天、哪个时段 */
export interface PlanStop { id: string; day: number; slot: SgSlot | 'stay'; at: LngLat; stay: boolean; alt: boolean }

const at = (id: string) => { const p = placeById.get(id); return p && !p.offmap ? p.at : null }

/** 实际走的路线按顺序经过的地点：每天从前一晚的住处出发，依次经过各时段（选了备选的按备选），最后到当晚的住处 */
export function mainStops(p: SgPlan, picked: Set<string>): PlanStop[] {
  const out: PlanStop[] = []
  const push = (id: string, day: number, slot: PlanStop['slot'], alt: boolean, stay = false) => {
    const pt = at(id)
    if (!pt) return
    if (out.length && out[out.length - 1].id === id) { if (stay) out[out.length - 1].stay = true; return }
    out.push({ id, day, slot, at: pt, stay, alt })
  }
  for (const d of p.days) {
    for (const s of effDay(d, picked).slots) for (const id of s.stops) push(id, d.day, s.slot.slot, !!s.alt)
    if (d.stay) push(d.stay, d.day, 'stay', false, true)
  }
  return out
}

/** 没选的备选从哪里接出去：这个时段之前最后经过的地点（按原计划算） */
export function altAnchor(p: SgPlan, ref: AltRef): LngLat | null {
  if (ref.alt.from) return at(ref.alt.from)
  const seq: string[] = []
  for (const d of p.days) {
    if (d.day === ref.day.day) {
      if (ref.slot != null) for (const s of d.slots.slice(0, ref.slot)) seq.push(...s.stops)
      break
    }
    for (const s of d.slots) seq.push(...s.stops)
    if (d.stay) seq.push(d.stay)
  }
  for (let i = seq.length - 1; i >= 0; i--) { const pt = at(seq[i]); if (pt) return pt }
  return null
}

/** 一天经过的所有地点（含前一晚住处、当天交通的两端），用来调整视野 */
export function dayPoints(p: SgPlan, day: number, picked: Set<string>): LngLat[] {
  const d = p.days.find((x) => x.day === day)
  if (!d) return []
  const prev = p.days.find((x) => x.day === day - 1)?.stay
  const ids = [prev, ...effDay(d, picked).slots.flatMap((s) => s.stops), d.stay, ...(d.rides ?? []).flatMap((r) => [r.from, r.to])]
  return ids.filter((x): x is string => !!x).map(at).filter((x): x is LngLat => !!x)
}

// —— 谷歌地图 ——

/** 有日文名就用日文名搜，比中文名准 */
const q = (id: string) => { const p = placeById.get(id); return p ? p.ja ?? p.name : id }
/** 在谷歌地图里看一个地点 */
export const gmapPlace = (id: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q(id))}`
const TRAVEL: Partial<Record<SgRide['mode'], string>> = { taxi: 'driving', shuttle: 'driving', car: 'driving' }
/** 在谷歌地图里查一段路怎么走；飞机查不了路线，只看目的地 */
export function gmapRide(r: SgRide) {
  if (r.mode === 'flight') return gmapPlace(r.to)
  const mode = TRAVEL[r.mode] ?? 'transit'
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(q(r.from))}&destination=${encodeURIComponent(q(r.to))}&travelmode=${mode}`
}
