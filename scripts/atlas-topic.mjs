#!/usr/bin/env node
// 按主题读整理好的经验：不用重读原帖，就能拿到某个地方、某件事上所有帖子说过的话。
// 主题定义在 atlas/topics.json：地方（函馆、大阪……）按区域归，专题（黑猫、机场……）按经验的类别和关键词归。
// 帖子属于哪几个主题写在 atlas/trips/<id>.json 的 topics 字段。
//
// 用法：
//   node scripts/atlas-topic.mjs                     所有主题一览：多少篇帖子、多少条经验
//   node scripts/atlas-topic.mjs <主题> [<主题>]      一个主题的摘要；写两个取交集，例如「函馆 交通」「大阪 机场」
//   node scripts/atlas-topic.mjs <主题> --posts      只列帖子，看完再挑几篇用 npm run -s read 读原文
//
// 主题可以写名字、id 或别名（topics.json 的 alias），例如 函馆 / hakodate、黑猫 / 宅急便。
// 摘要里每条后面的 ‹6acef507› 是出处帖子的 ID 前 8 位，写建议路线的 refs 时直接用。
// 也可以用 npm：npm run -s topic -- <参数>

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ATLAS, readJson } from './lib/notes.mjs'
import { loadTopics, loadTrips, resolveTopic } from './lib/topics.mjs'

const argv = process.argv.slice(2)
const postsOnly = argv.includes('--posts')
const names = argv.filter((a) => !a.startsWith('--'))

const out = []
const say = (s = '') => out.push(s)

const topics = await loadTopics()
const trips = await loadTrips()
const sources = await readJson(join(ATLAS, 'sources.json')).catch(() => ({}))
const { areas } = await readJson(join(ATLAS, 'areas.json'))
const areaName = new Map(areas.map((a) => [a.id, a.name]))
const places = new Map()
for (const f of (await readdir(join(ATLAS, 'places'))).filter((f) => f.endsWith('.json'))) {
  for (const p of await readJson(join(ATLAS, 'places', f))) places.set(p.id, p)
}

const ref = (id) => `‹${id.slice(0, 8)}›`
const FROM = { comment: '评论', editor: '整理者', post: '' }
const tag = (x) => (FROM[x.from] ? `［${FROM[x.from]}］` : '')
const TONE = { good: '＋', warn: '！', meh: '－', info: '·' }

/** 一个主题能收进哪些经验。返回判断函数，交集时逐条都要满足 */
function matcher(t) {
  const re = t.match ? new RegExp(t.match, 'i') : null
  const text = (x) => !!re && re.test([x.text, x.how, x.time, x.cost].filter(Boolean).join(' '))
  if (t.type === 'place') {
    const inArea = (a) => t.areas.includes(a)
    return {
      note: (n) => inArea(places.get(n.place)?.area),
      leg: (l) => l.between.some(inArea),
      // 只去这一个地方的帖子，它不针对地点的建议也算这个地方的
      tip: (_x, trip) => (trip.topics ?? []).filter((id) => topics.byId.get(id)?.type === 'place').length === 1 && trip.topics.includes(t.id),
    }
  }
  return {
    note: (n) => (t.kinds ?? []).includes(places.get(n.place)?.kind) || (t.themes ?? []).some((th) => places.get(n.place)?.themes?.includes(th)) || text(n),
    leg: (l) => !!t.legs || text(l) || (l.notes ?? []).some(text),
    tip: (x) => !!t.allTips || (t.tips ?? []).includes(x.topic) || text(x),
  }
}

function collect(sel) {
  const ms = sel.map(matcher)
  const all = (k, ...a) => ms.every((m) => m[k](...a))
  const posts = trips.filter(({ trip }) => sel.every((t) => trip.topics?.includes(t.id)))
  const notes = [], legs = [], tips = []
  for (const { id, trip } of trips) {
    for (const n of trip.notes ?? []) if (all('note', n, trip)) notes.push({ ...n, trip: id })
    for (const l of trip.legs ?? []) if (all('leg', l, trip)) legs.push({ ...l, trip: id })
    for (const x of trip.tips ?? []) if (all('tip', x, trip)) tips.push({ ...x, trip: id })
  }
  return { posts, notes, legs, tips }
}

function overview() {
  const tagged = trips.filter(({ trip }) => trip.topics?.length).length
  say(`主题一览（atlas/topics.json）。${trips.length} 篇整理过的帖子里 ${tagged} 篇标了主题。列：帖子 · 地点经验 · 城际交通 · 通用建议`)
  for (const [label, type] of [['地方', 'place'], ['专题', 'subject']]) {
    const list = topics.all.filter((t) => t.type === type)
    say(`\n── ${label}`)
    for (const t of list) {
      const c = collect([t])
      const alias = t.alias?.length ? `（${t.alias.join('、')}）` : ''
      say(`${t.name.padEnd(10, '　')} ${String(c.posts.length).padStart(3)} 篇 ${String(c.notes.length).padStart(4)} ${String(c.legs.length).padStart(4)} ${String(c.tips.length).padStart(4)}   ${t.id}${alias}${t.hint ? ` — ${t.hint}` : ''}`)
    }
  }
  const none = trips.filter(({ trip }) => !trip.topics?.length)
  if (none.length) say(`\n没有标主题的：${none.map(({ id }) => id.slice(0, 8)).join(' ')}`)
}

function postLine({ id, trip }) {
  const s = sources[id]
  const read = trip.read ? '' : ' ［没有 read 记录］'
  const other = (trip.topics ?? []).map((x) => topics.byId.get(x)?.name ?? x).join('、')
  return `${ref(id)} ${s?.title ?? ''}（${s?.author ?? '?'} · 藏 ${s?.counts?.collected ?? '?'}）${read}\n    ${trip.summary}\n    主题：${other}`
}

function digest(sel) {
  const c = collect(sel)
  const title = sel.map((t) => t.name).join(' × ')
  say(`━━ ${title}：${c.posts.length} 篇帖子，${c.notes.length} 条地点经验，${c.legs.length} 条城际交通，${c.tips.length} 条通用建议`)
  say(`\n── 帖子（标了${sel.length > 1 ? '这几个' : '这个'}主题的；按收藏数排）`)
  c.posts.sort((a, b) => (sources[b.id]?.counts?.collected ?? 0) - (sources[a.id]?.counts?.collected ?? 0))
  for (const p of c.posts) say(postLine(p))
  if (!c.posts.length) say('（没有）')
  if (postsOnly) return

  if (c.notes.length) {
    say('\n── 地点经验（按地点；＋推荐 ！注意 －一般 ·信息）')
    const by = new Map()
    for (const n of c.notes) by.set(n.place, [...(by.get(n.place) ?? []), n])
    const order = [...by].sort((a, b) => b[1].length - a[1].length)
    for (const [pid, list] of order) {
      const p = places.get(pid)
      say(`◆ ${p?.name ?? pid}（${pid} · ${areaName.get(p?.area) ?? p?.area}）`)
      for (const n of list) say(`  ${TONE[n.tone] ?? '·'} ${n.text}${tag(n)} ${ref(n.trip)}`)
    }
  }
  if (c.legs.length) {
    say('\n── 城际交通')
    const by = new Map()
    for (const l of c.legs) {
      const k = l.between.map((a) => areaName.get(a) ?? a).join(' → ')
      by.set(k, [...(by.get(k) ?? []), l])
    }
    for (const [k, list] of [...by].sort((a, b) => b[1].length - a[1].length)) {
      say(`◆ ${k}`)
      for (const l of list) {
        const head = [l.mode?.join('/'), l.time, l.cost].filter(Boolean).join(' · ')
        if (l.how) say(`  ${head ? `[${head}] ` : ''}${l.how}${tag(l)} ${ref(l.trip)}`)
        for (const n of l.notes ?? []) say(`  ${TONE[n.tone] ?? '·'} ${n.text}${tag(n)} ${ref(l.trip)}`)
      }
    }
  }
  if (c.tips.length) {
    say('\n── 通用建议（按类别）')
    const by = new Map()
    for (const x of c.tips) by.set(x.topic, [...(by.get(x.topic) ?? []), x])
    for (const [k, list] of [...by].sort((a, b) => b[1].length - a[1].length)) {
      say(`◆ ${k}`)
      for (const x of list) say(`  · ${x.text}${tag(x)} ${ref(x.trip)}`)
    }
  }
}

try {
  if (!names.length) overview()
  else digest(names.map((n) => resolveTopic(topics, n)))
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
process.stdout.write(out.join('\n') + '\n')
