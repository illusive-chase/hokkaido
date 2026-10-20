#!/usr/bin/env node
// 从 data/captures/<noteId>/snapshots/*.json 重新生成 comments.json。
// 平时不需要跑：插件保存时已经合并好了。只在改了 extension/lib.js 的归一化逻辑之后，
// 用它把以前存下的原始快照按新逻辑重算一遍。和插件共用同一份 extension/lib.js。
//
// 用法：node scripts/merge-captures.mjs [noteId …] [--data <dir>]

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { mergeCapture, normalizeSnapshot } from '../extension/lib.js'

const argv = process.argv.slice(2)
const di = argv.indexOf('--data')
const DATA = di >= 0 ? argv.splice(di, 2)[1] : 'data'
const CAPTURES = join(DATA, 'captures')
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))

async function rebuild(id) {
  const dir = join(CAPTURES, id, 'snapshots')
  const files = existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.json')).sort() : []
  if (!files.length) return console.warn(`! ${id}：没有快照，跳过`)
  const notePath = join(DATA, 'notes', id, 'note.json')
  const hint = existsSync(notePath) ? { topLevelTotal: (await readJson(notePath)).comments?.topLevelTotal } : {}
  let merged = null
  for (const f of files) {
    const s = await readJson(join(dir, f))
    const snap = normalizeSnapshot(
      { noteId: s.noteId, mode: s.mode, note: s.note, comments: s.comments },
      { url: s.url, capturedAt: Date.parse(s.capturedAt) },
      hint,
    )
    merged = mergeCapture(merged, snap, `snapshots/${f}`)
  }
  await writeFile(join(CAPTURES, id, 'comments.json'), JSON.stringify(merged, null, 2) + '\n')
  const c = merged.complete
  console.log(`${id}  ${files.length} 次快照 → ${merged.loaded.topLevel} 条一级 + ${merged.loaded.replies} 条回复` +
    `${merged.total ? ` / 共 ${merged.total}` : ''}` +
    `${c.topLevel ? '' : '，一级评论没到底'}${c.pendingThreads ? `，${c.pendingThreads} 楼回复没展开完` : ''}`)
}

const ids = argv.length ? argv : existsSync(CAPTURES) ? (await readdir(CAPTURES)).filter((f) => /^[0-9a-f]{24}$/.test(f)) : []
if (!ids.length) console.log(`${CAPTURES} 里还没有插件保存的数据`)
for (const id of ids.sort()) await rebuild(id)
