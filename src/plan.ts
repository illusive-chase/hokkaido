import { placeById, trips } from './data'
import type { AltKind, SgAlt, SgDay, SgPlan, SgSlot, Trip } from './types'

type LngLat = [number, number]

const planFiles = import.meta.glob<Omit<SgPlan, 'id'>>('../atlas/plans/*.json', { eager: true, import: 'default' })
export const plans: SgPlan[] = Object.entries(planFiles).map(([path, p]) => ({ ...p, id: path.split('/').pop()!.replace('.json', '') }))
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

/** 一个地点在路线上的位置：第几天、哪个时段 */
export interface PlanStop { id: string; day: number; slot: SgSlot | 'stay'; at: LngLat; stay: boolean }

const at = (id: string) => { const p = placeById.get(id); return p && !p.offmap ? p.at : null }

/** 主路线按顺序经过的地点：每天从前一晚的住处出发，依次经过各时段的地点，最后到当晚的住处 */
export function mainStops(p: SgPlan): PlanStop[] {
  const out: PlanStop[] = []
  const push = (id: string, day: number, slot: PlanStop['slot'], stay = false) => {
    const pt = at(id)
    if (!pt) return
    if (out.length && out[out.length - 1].id === id) { if (stay) out[out.length - 1].stay = true; return }
    out.push({ id, day, slot, at: pt, stay })
  }
  for (const d of p.days) {
    for (const s of d.slots) for (const id of s.stops) push(id, d.day, s.slot)
    if (d.stay) push(d.stay, d.day, 'stay', true)
  }
  return out
}

/** 分支从哪里接出去：这个时段之前最后经过的地点 */
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

/** 一天经过的所有地点（含前一晚住处），用来调整视野 */
export function dayPoints(p: SgPlan, day: number, alt?: AltRef | null): LngLat[] {
  const d = p.days.find((x) => x.day === day)
  if (!d) return []
  const prev = p.days.find((x) => x.day === day - 1)?.stay
  const ids = [prev, ...d.slots.flatMap((s) => s.stops), d.stay, ...(alt ? alt.alt.stops : [])].filter((x): x is string => !!x)
  return ids.map(at).filter((x): x is LngLat => !!x)
}
