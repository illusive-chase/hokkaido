#!/usr/bin/env node
// 从 data/notes/ 生成网站要用的数据。分两部分：
//   atlas/sources.json   帖子元信息快照（标题、作者、互动数、图片尺寸），进 git，
//                        这样没有 data/ 的机器也能跑起网站（只是没有图片和原文）
//   local/               图片（统一转成 jpg）和原文、评论，不进 git；npm run seal 把它加密进 public/vault/
// 评论优先用插件采集的 data/captures/<id>/comments.json，再补上 note.json 里它没有的几条。
// 同时校验 atlas/ 里所有的地点、区域引用。
//
// 用法：node scripts/build-site-data.mjs [--no-media] [--force-media]

import { writeFile, readdir, mkdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { validate } from './check-atlas.mjs'
import { ATLAS, loadNote, NOTES as DATA, readJson, ROOT, stripEmoji } from './lib/notes.mjs'

const run = promisify(execFile)
const LOCAL = join(ROOT, 'local')
const FULL_PX = 1600
const THUMB_PX = 480
const args = new Set(process.argv.slice(2))

const pad = (i) => String(i + 1).padStart(2, '0')

async function convert(src, dst, px) {
  if (!args.has('--force-media') && existsSync(dst)) return
  if (process.platform === 'darwin') {
    await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '78', '-Z', String(px), src, '--out', dst])
  } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(extname(src).toLowerCase())) {
    await copyFile(src, dst) // 非 macOS：原样复制，浏览器能直接显示；HEIC 只能跳过
  } else {
    throw new Error(`无法转换 ${src}（非 macOS 环境下不支持 HEIC）`)
  }
}

function textOf({ note, items, comments }) {
  const c = (x) => ({
    user: x.user?.nickname ?? '',
    isAuthor: x.isAuthor ?? x.user?.id === note.author?.id,
    content: stripEmoji(x.content ?? ''),
    time: x.time,
    ip: x.ipLocation,
    likes: x.likeCount,
  })
  return {
    desc: stripEmoji(note.desc ?? '').replace(/\uFEFF/g, ''),
    comments: items.map((x) => ({ ...c(x), pinned: !!x.isPinned, replies: (x.subComments ?? []).map(c), replyTotal: x.subCommentCount })),
    commentTotal: comments.total,
    // full：插件采集过；complete：一级评论翻到底并且回复全部展开
    commentSource: comments.full ? { full: true, complete: comments.complete, at: comments.at } : { full: false },
  }
}

async function main() {
  const tripIds = (await readdir(join(ATLAS, 'trips'))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
  const prev = existsSync(join(ATLAS, 'sources.json')) ? await readJson(join(ATLAS, 'sources.json')) : {}
  const sources = {}
  let missing = 0, imgCount = 0, imgFailed = [], captured = 0

  for (const id of tripIds.sort()) {
    const notePath = join(DATA, id, 'note.json')
    if (!existsSync(notePath)) {
      if (prev[id]) sources[id] = prev[id]
      else missing++
      console.warn(`! ${id}：data/notes 里没有这篇${prev[id] ? '，沿用 sources.json 里的旧快照' : ''}`)
      continue
    }
    const loaded = await loadNote(id)
    const { note } = loaded
    const images = (note.images ?? []).map((im) => ({
      w: im.width, h: im.height, live: !!im.livePhoto,
    }))
    sources[id] = {
      title: note.title,
      author: note.author?.nickname ?? '',
      publishTime: note.publishTime,
      counts: note.counts,
      url: note.url,
      tags: note.tags ?? [],
      images,
      fetchedAt: note.source?.fetchedAt ?? null,
    }
    if (args.has('--no-media')) continue

    await mkdir(join(LOCAL, 'img', id), { recursive: true })
    await mkdir(join(LOCAL, 'thumb', id), { recursive: true })
    await mkdir(join(LOCAL, 'text'), { recursive: true })
    if (loaded.comments.full) captured++
    await writeFile(join(LOCAL, 'text', `${id}.json`), JSON.stringify(textOf(loaded)))
    for (const [i, im] of (note.images ?? []).entries()) {
      if (!im.local) continue
      const src = join(DATA, id, im.local)
      try {
        await convert(src, join(LOCAL, 'img', id, `${pad(i)}.jpg`), FULL_PX)
        await convert(src, join(LOCAL, 'thumb', id, `${pad(i)}.jpg`), THUMB_PX)
        imgCount++
      } catch (e) {
        imgFailed.push(`${id}/${im.local}: ${e.message.split('\n')[0]}`)
      }
    }
    process.stdout.write('.')
  }
  process.stdout.write('\n')

  await writeFile(join(ATLAS, 'sources.json'), JSON.stringify(sources, null, 1) + '\n')
  console.log(`atlas/sources.json：${Object.keys(sources).length} 篇`)
  if (!args.has('--no-media')) console.log(`local/：${imgCount} 张图片${imgFailed.length ? `，${imgFailed.length} 张失败` : ''}；${captured} 篇用了插件采集的评论`)
  for (const f of imgFailed) console.warn('  ' + f)
  if (missing) console.warn(`! 有 ${missing} 篇行程既没有 data/notes 也没有旧快照`)

  const problems = await validate()
  if (problems.length) {
    console.error(`\n校验发现 ${problems.length} 个问题：`)
    for (const p of problems) console.error('  - ' + p)
    process.exit(1)
  }
  console.log('atlas 校验通过')
}

main().catch((e) => { console.error(e); process.exit(1) })
