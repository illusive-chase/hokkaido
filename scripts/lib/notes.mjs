// 读一篇帖子的本地数据：data/notes/<id>/note.json + data/captures/<id>/comments.json（有的话）
// + data/ocr/<id>.json（图片里识别出的文字，scripts/ocr.mjs 生成）。
// scripts/build-site-data.mjs 和 scripts/xhs-read.mjs 共用，保证两边合并评论的方式一致。

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = new URL('../..', import.meta.url).pathname
export const NOTES = join(ROOT, 'data/notes')
export const CAPTURES = join(ROOT, 'data/captures')
export const OCR = join(ROOT, 'data/ocr')
export const ATLAS = join(ROOT, 'atlas')

export const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))

/** 去掉小红书的表情代码：[笑哭R] [doge H] */
export const stripEmoji = (s) => s.replace(/\[([^\[\]]{1,8})[RH]\]/g, '')

/** 按评论 ID 取并集，a 在前。插件采集和 note.json 的评论 ID 是同一套 */
export function unionComments(a = [], b = []) {
  const seen = new Map(a.map((x) => [x.id, x]))
  const out = [...a]
  for (const x of b) {
    const hit = seen.get(x.id)
    if (!hit) out.push(x)
    else if (x.subComments?.length) {
      const ids = new Set((hit.subComments ?? []).map((r) => r.id))
      hit.subComments = [...(hit.subComments ?? []), ...x.subComments.filter((r) => !ids.has(r.id))]
    }
  }
  return out
}

/**
 * 图片里有用的文字：去掉没有字母数字的行；整张图不到 8 个字的（招牌、路牌、背景）不要。
 * 返回 [{ img: 第几张（1 起）, lines }]
 */
export function ocrPages(ocr) {
  const out = []
  for (const im of ocr?.images ?? []) {
    const lines = (im.lines ?? []).map((l) => l.trim()).filter((l) => /[\p{L}\p{N}]/u.test(l))
    if (lines.join('').replace(/[^\p{L}\p{N}]/gu, '').length < 8) continue
    out.push({ img: parseInt(im.file, 10), lines })
  }
  return out
}

/** data/notes 里所有帖子的 ID */
export async function noteIds() {
  if (!existsSync(NOTES)) return []
  return (await readdir(NOTES)).filter((f) => /^[0-9a-f]{24}$/.test(f)).sort()
}

/**
 * 一篇帖子的正文和合并后的评论。
 * comments.full：插件采集过；complete：一级评论翻到底并且回复全部展开
 */
export async function loadNote(id) {
  const notePath = join(NOTES, id, 'note.json')
  if (!existsSync(notePath)) return null
  const note = await readJson(notePath)
  const capPath = join(CAPTURES, id, 'comments.json')
  const capture = existsSync(capPath) ? await readJson(capPath) : null
  const items = capture
    ? unionComments(structuredClone(capture.items), note.comments?.items)
    : structuredClone(note.comments?.items ?? [])
  const replies = items.reduce((s, c) => s + (c.subComments?.length ?? 0), 0)
  const ocrPath = join(OCR, `${id}.json`)
  return {
    id,
    note,
    capture,
    items,
    /** null：还没跑过 npm run ocr */
    ocr: existsSync(ocrPath) ? ocrPages(await readJson(ocrPath)) : null,
    comments: {
      full: !!capture,
      complete: !!(capture?.complete?.topLevel && capture?.complete?.replies),
      topDone: capture ? !!capture.complete?.topLevel : !note.comments?.hasMore,
      pendingThreads: capture?.complete?.pendingThreads ?? 0,
      total: capture?.total ?? note.comments?.total ?? null,
      topLevelTotal: capture?.topLevelTotal ?? note.comments?.topLevelTotal ?? null,
      topLevel: items.length,
      replies,
      at: capture?.updatedAt ?? null,
    },
  }
}
