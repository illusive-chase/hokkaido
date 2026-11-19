// 主题分类：atlas/topics.json 定义有哪些主题，atlas/trips/<id>.json 的 topics 字段写这篇属于哪几个。
// scripts/atlas-topic.mjs（按主题出摘要）、scripts/xhs-read.mjs（--topic 限定范围）、scripts/check-atlas.mjs 共用。

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ATLAS, readJson } from './notes.mjs'

export async function loadTopics() {
  const t = await readJson(join(ATLAS, 'topics.json'))
  const all = [...t.places.map((x) => ({ ...x, type: 'place' })), ...t.subjects.map((x) => ({ ...x, type: 'subject' }))]
  return { ...t, all, byId: new Map(all.map((x) => [x.id, x])) }
}

/** 主题名、id、别名都能用；都对不上时按名字包含匹配，仍然不唯一就报错 */
export function resolveTopic(topics, q) {
  const s = q.trim().toLowerCase()
  const exact = topics.all.filter((x) => [x.id, x.name, ...(x.alias ?? [])].some((n) => n.toLowerCase() === s))
  if (exact.length === 1) return exact[0]
  const part = topics.all.filter((x) => [x.name, ...(x.alias ?? [])].some((n) => n.toLowerCase().includes(s)))
  if (part.length === 1) return part[0]
  const names = topics.all.map((x) => x.name).join('、')
  throw new Error(part.length ? `「${q}」对应几个主题：${part.map((x) => x.name).join('、')}` : `没有「${q}」这个主题。现有：${names}`)
}

/** 所有整理过的帖子：{ id, trip } */
export async function loadTrips() {
  const dir = join(ATLAS, 'trips')
  if (!existsSync(dir)) return []
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
  return Promise.all(files.map(async (f) => ({ id: f.slice(0, -5), trip: await readJson(join(dir, f)) })))
}
