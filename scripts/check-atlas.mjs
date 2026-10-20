#!/usr/bin/env node
// 校验 atlas/ 里的整理数据：字段是否合法、引用的地点和区域是否存在。
// 单独运行：node scripts/check-atlas.mjs
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ATLAS = new URL('../atlas', import.meta.url).pathname
const KINDS = new Set(['itinerary', 'daytrip', 'pilgrimage', 'guide', 'review', 'question'])
const PLACE_KINDS = new Set(['town', 'sight', 'station', 'airport', 'food', 'stay'])
const TONES = new Set(['good', 'warn', 'meh', 'info'])
const FROM = new Set(['post', 'comment', 'editor'])
const TRIP_KEYS = new Set(['kind', 'summary', 'days', 'when', 'season', 'bases', 'in', 'out', 'style', 'budget', 'partial', 'commercial', 'plan', 'photos', 'notes', 'tips', 'ratings', 'legs'])
const MODES = new Set(['jr', 'bus', 'shuttle', 'car', 'charter', 'tour', 'flight', 'taxi'])
const LEG_KEYS = new Set(['between', 'day', 'mode', 'how', 'time', 'cost', 'from', 'notes'])
const SLOTS = new Set(['am', 'pm', 'eve'])
const ALT_KINDS = new Set(['snow', 'cloud', 'nosnow', 'sunny', 'makeup'])

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))

export async function validate() {
  const out = []
  const { areas, regions, themes } = await readJson(join(ATLAS, 'areas.json'))
  const areaIds = new Set(areas.map((a) => a.id))
  const regionIds = new Set(regions.map((r) => r.id))
  const themeSet = new Set(themes)
  for (const a of areas) if (a.region !== null && !regionIds.has(a.region)) out.push(`区域 ${a.id}：未知大区 ${a.region}`)

  const places = new Map()
  for (const f of (await readdir(join(ATLAS, 'places'))).filter((f) => f.endsWith('.json'))) {
    for (const p of await readJson(join(ATLAS, 'places', f))) {
      const at = `places/${f} ${p.id}`
      if (places.has(p.id)) out.push(`${at}：id 重复`)
      places.set(p.id, p)
      if (!PLACE_KINDS.has(p.kind)) out.push(`${at}：kind 不合法 ${p.kind}`)
      if (!areaIds.has(p.area)) out.push(`${at}：未知区域 ${p.area}`)
      if (!Array.isArray(p.at) || p.at.length !== 2 || p.at[0] < 139 || p.at[0] > 146 || p.at[1] < 35 || p.at[1] > 46) out.push(`${at}：坐标不对 ${p.at}`)
      for (const t of p.themes ?? []) if (!themeSet.has(t)) out.push(`${at}：未知主题 ${t}`)
    }
  }

  const sources = existsSync(join(ATLAS, 'sources.json')) ? await readJson(join(ATLAS, 'sources.json')) : {}
  const place = (at, id) => { if (!places.has(id)) out.push(`${at}：未知地点 ${id}`) }
  for (const f of (await readdir(join(ATLAS, 'trips'))).filter((f) => f.endsWith('.json'))) {
    const id = f.slice(0, -5)
    const t = await readJson(join(ATLAS, 'trips', f))
    const at = `trips/${id}`
    if (!/^[0-9a-f]{24}$/.test(id)) out.push(`${at}：文件名应是 24 位笔记 ID`)
    if (!sources[id]) out.push(`${at}：sources.json 里没有这篇（先运行 npm run data）`)
    for (const k of Object.keys(t)) if (!TRIP_KEYS.has(k)) out.push(`${at}：未知字段 ${k}`)
    if (!KINDS.has(t.kind)) out.push(`${at}：kind 不合法 ${t.kind}`)
    if (!t.summary) out.push(`${at}：缺 summary`)
    for (const b of t.bases ?? []) if (!areaIds.has(b)) out.push(`${at}：bases 里的未知区域 ${b}`)
    if (t.in) place(at, t.in)
    if (t.out) place(at, t.out)
    for (const d of t.plan ?? []) {
      if (typeof d.day !== 'number') out.push(`${at}：plan 每一项需要数字 day`)
      if (d.stay) place(`${at} D${d.day}`, d.stay)
      for (const s of d.stops ?? []) place(`${at} D${d.day}`, s)
    }
    const nImg = sources[id]?.images?.length ?? Infinity
    for (const ph of t.photos ?? []) {
      place(at, ph.place)
      for (const i of ph.img) if (i < 1 || i > nImg) out.push(`${at}：photos 引用了不存在的第 ${i} 张图`)
    }
    for (const n of t.notes ?? []) {
      place(at, n.place)
      if (!TONES.has(n.tone)) out.push(`${at}：notes.tone 不合法 ${n.tone}`)
      if (!FROM.has(n.from)) out.push(`${at}：notes.from 不合法 ${n.from}`)
    }
    for (const n of t.tips ?? []) if (!FROM.has(n.from)) out.push(`${at}：tips.from 不合法 ${n.from}`)
    for (const r of t.ratings ?? []) place(at, r.place)
    for (const [k, l] of (t.legs ?? []).entries()) {
      const lt = `${at} legs[${k}]`
      for (const key of Object.keys(l)) if (!LEG_KEYS.has(key)) out.push(`${lt}：未知字段 ${key}`)
      if (!Array.isArray(l.between) || l.between.length !== 2) { out.push(`${lt}：between 应是两个区域`); continue }
      for (const a of l.between) if (!areaIds.has(a)) out.push(`${lt}：未知区域 ${a}`)
      if (l.between[0] === l.between[1]) out.push(`${lt}：起点和终点是同一个区域 ${l.between[0]}（区域内的交通写进 notes 或 tips）`)
      for (const m of l.mode ?? []) if (!MODES.has(m)) out.push(`${lt}：mode 不合法 ${m}`)
      if (l.from && !FROM.has(l.from)) out.push(`${lt}：from 不合法 ${l.from}`)
      if (l.notes && !l.notes.length) out.push(`${lt}：notes 是空数组，没有就不要写`)
      if (!l.how && !l.notes?.length) out.push(`${lt}：how 和 notes 至少要有一个`)
      for (const n of l.notes ?? []) {
        if (!TONES.has(n.tone)) out.push(`${lt}：notes.tone 不合法 ${n.tone}`)
        if (!FROM.has(n.from)) out.push(`${lt}：notes.from 不合法 ${n.from}`)
        if (!n.text) out.push(`${lt}：notes 缺 text`)
      }
    }
  }
  // 建议路线：地点、帖子出处、交通方式、分支类型都要能对上
  const tripIds = (await readdir(join(ATLAS, 'trips'))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
  const ref = (at, r) => { if (tripIds.filter((id) => id.startsWith(r)).length !== 1) out.push(`${at}：出处 ${r} 对不上唯一一篇帖子`) }
  const refs = (at, list) => { for (const r of list ?? []) ref(at, r) }
  const links = (at, list) => {
    for (const l of list ?? []) {
      if (!l.name) out.push(`${at}：links 缺 name`)
      if (!/^https:\/\//.test(l.url ?? '')) out.push(`${at}：links 的 url 应以 https:// 开头 ${l.url}`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date ?? '')) out.push(`${at}：links 的 date 应写查阅日期 YYYY-MM-DD ${l.date}`)
    }
  }
  const cite = (at, x) => { refs(at, x.refs); links(at, x.links) }
  const planDir = join(ATLAS, 'plans')
  for (const f of existsSync(planDir) ? (await readdir(planDir)).filter((f) => f.endsWith('.json')) : []) {
    const p = await readJson(join(planDir, f))
    const at = `plans/${f}`
    for (const k of ['title', 'summary', 'in', 'out', 'prefs', 'rules', 'days']) if (p[k] == null) out.push(`${at}：缺 ${k}`)
    place(at, p.in)
    place(at, p.out)
    for (const g of p.rules ?? []) for (const it of g.items ?? []) cite(`${at} rules`, it)
    const alt = (dt, a) => {
      if (!ALT_KINDS.has(a.kind)) out.push(`${dt}：分支 kind 不合法 ${a.kind}`)
      for (const k of ['if', 'short', 'title', 'text']) if (!a[k]) out.push(`${dt}：分支缺 ${k}`)
      if (a.from) place(dt, a.from)
      for (const s of a.stops ?? []) place(dt, s)
      cite(dt, a)
    }
    for (const [i, d] of (p.days ?? []).entries()) {
      const dt = `${at} D${d.day}`
      if (d.day !== (p.days[0]?.day ?? 1) + i) out.push(`${dt}：day 应该连续`)
      if (d.stay) place(dt, d.stay)
      refs(dt, d.stayRefs)
      if (d.move) {
        for (const a of d.move.between ?? []) if (!areaIds.has(a)) out.push(`${dt} move：未知区域 ${a}`)
        for (const m of d.move.mode ?? []) if (!MODES.has(m)) out.push(`${dt} move：mode 不合法 ${m}`)
        cite(`${dt} move`, d.move)
      }
      for (const s of d.slots ?? []) {
        if (!SLOTS.has(s.slot)) out.push(`${dt}：slot 不合法 ${s.slot}`)
        for (const id of s.stops ?? []) place(dt, id)
        cite(dt, s)
        for (const a of s.alts ?? []) alt(`${dt} ${s.slot}`, a)
      }
      for (const a of d.alts ?? []) alt(`${dt} 整天`, a)
    }
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = await validate()
  for (const p of problems) console.error('- ' + p)
  console.log(problems.length ? `${problems.length} 个问题` : 'atlas 校验通过')
  process.exit(problems.length ? 1 : 0)
}
