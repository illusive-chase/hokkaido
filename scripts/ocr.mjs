#!/usr/bin/env node
// 识别帖子图片里的文字，存进 data/ocr/<noteId>.json，给 scripts/xhs-read.mjs 一起打印出来。
// 攻略图、时刻表、行程表里的信息很多只在图上，正文和评论里没有。
// 用 macOS 自带的 Vision（scripts/ocr/ocr.swift，第一次运行时编译），不需要联网，也不用装别的。
// 已经识别过、文件没变的图跳过，所以下载了新帖子以后直接再跑一遍就行。
//
// 用法：node scripts/ocr.mjs [noteId 前缀 …] [--force]
//   不带 ID   处理 data/notes 里的全部帖子
//   --force   已经识别过的也重新识别

import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { NOTES, OCR, ROOT, noteIds, readJson } from './lib/notes.mjs'

const run = promisify(execFile)
const SRC = join(ROOT, 'scripts/ocr/ocr.swift')
const BIN = join(ROOT, 'node_modules/.cache/hokkaido/ocr')
const IMAGE = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i
const BATCH = 40

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const prefixes = argv.filter((a) => !a.startsWith('--'))

async function binary() {
  if (process.platform !== 'darwin') throw new Error('OCR 用的是 macOS 自带的 Vision，只能在 macOS 上运行')
  if (existsSync(BIN) && statSync(BIN).mtimeMs >= statSync(SRC).mtimeMs) return BIN
  await mkdir(join(BIN, '..'), { recursive: true })
  console.log('编译 scripts/ocr/ocr.swift …')
  await run('swiftc', ['-O', SRC, '-o', BIN])
  return BIN
}

async function main() {
  const all = await noteIds()
  const ids = prefixes.length ? all.filter((id) => prefixes.some((p) => id.startsWith(p))) : all
  if (!ids.length) return console.log('没有要处理的帖子')
  const bin = await binary()
  await mkdir(OCR, { recursive: true })
  let done = 0, skipped = 0
  for (const id of ids) {
    const dir = join(NOTES, id, 'images')
    if (!existsSync(dir)) continue
    const files = (await readdir(dir)).filter((f) => IMAGE.test(f)).sort()
    const path = join(OCR, `${id}.json`)
    const old = existsSync(path) && !force ? await readJson(path) : null
    const prev = new Map((old?.images ?? []).map((x) => [x.file, x]))
    const images = []
    const todo = []
    for (const file of files) {
      const bytes = statSync(join(dir, file)).size
      const hit = prev.get(file)
      if (hit && hit.bytes === bytes) { images.push(hit); skipped++ }
      else { const row = { file, bytes, lines: null }; images.push(row); todo.push(row) }
    }
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH)
      const { stdout } = await run(bin, batch.map((x) => join(dir, x.file)), { maxBuffer: 64 << 20 })
      // Vision 偶尔会往 stdout 打诊断信息（例如 too few samples），只取 JSON 行
      const got = new Map(stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).map((r) => [r.file, r.lines]))
      for (const x of batch) x.lines = got.get(join(dir, x.file)) ?? null
      done += batch.length
    }
    if (todo.length || !old) await writeFile(path, JSON.stringify({ schema: 1, noteId: id, images }, null, 1) + '\n')
    if (todo.length) process.stdout.write('.')
  }
  process.stdout.write('\n')
  console.log(`data/ocr/：新识别 ${done} 张，沿用 ${skipped} 张`)
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
