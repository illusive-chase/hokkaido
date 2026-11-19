#!/usr/bin/env node
// 给人和 agent 读帖子用的命令行：把 data/notes 的正文、data/ocr 的图片文字和 data/captures 的完整评论，
// 合并、去噪后按「一楼一行」打印成纯文本。比直接 cat JSON 省掉头像、用户 ID、签名链接这些字段，
// 体积大约是原始 JSON 的 1/5，并且楼层编号固定，方便在整理时引用。
//
// 用法：
//   node scripts/xhs-read.mjs list                    所有帖子一览：评论、图片文字、整理到了什么程度
//   node scripts/xhs-read.mjs todo                    还要读的帖子：没整理过的、整理后又采集到新评论的、图片文字没读过的
//   node scripts/xhs-read.mjs <id> [选项]             读一篇。id 写前 6 位以上即可
//   node scripts/xhs-read.mjs grep <正则> [id …]      在正文、图片文字和评论里搜索，可限定几篇
//   node scripts/xhs-read.mjs done <id …>             整理完以后，在 atlas/trips/<id>.json 记下读到了哪（read 字段）
//
// list、todo、grep 可以加 --topic <主题>，只看 atlas/topics.json 里这个主题的帖子（按 trips 的 topics 字段）。
// 例如 grep '时刻|末班' --topic 函馆。没整理过的帖子还没有主题，不会被选中。
//
// 读一篇时的选项：
//   --no-desc        不打印正文            --no-comments    不打印评论
//   --no-ocr         不打印图片文字
//   --grep <正则>    只看命中的楼（楼主或任意一条回复命中即保留整楼）
//   --author         只看作者参与的楼      --min-likes <n>  只看点赞 ≥ n 的楼
//   --top <n>        只看前 n 楼           --sort likes     按楼主点赞数排序（默认保持页面上的顺序）
//   --replies <n>    每楼最多显示 n 条回复  --all            连无内容评论和 AI 助手回复也显示
//   --brief          每条评论不带 IP 属地和日期，再省三成左右
//
// 也可以用 npm：npm run -s read -- <参数>

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ATLAS, loadNote, noteIds as allIds, readJson, stripEmoji } from './lib/notes.mjs'
import { loadTopics, loadTrips, resolveTopic } from './lib/topics.mjs'

/** 图片文字超过这么多字，才算「要读」：少于这个数的多半是封面标题、招牌、截图边角 */
const OCR_WORTH = 300

const argv = process.argv.slice(2)
const flags = new Map()
const pos = []
const VALUED = new Set(['--grep', '--min-likes', '--top', '--replies', '--sort', '--topic'])
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (VALUED.has(a)) flags.set(a, argv[++i])
  else if (a.startsWith('--')) flags.set(a, true)
  else pos.push(a)
}

const BRIEF = flags.has('--brief')
const out = []
const say = (s = '') => out.push(s)
const flush = () => process.stdout.write(out.join('\n') + '\n')

// —— 文本清理 ——
const oneLine = (s) => stripEmoji(s ?? '').replace(/\s*\n+\s*/g, ' / ').replace(/\s{2,}/g, ' ').trim()
function cleanDesc(s) {
  return stripEmoji(s ?? '')
    .replace(/#([^#\n]{1,30})\[话题\]#/g, '') // 话题标签单独在表头列出
    .replace(/﻿/g, '')
    .split('\n').map((l) => l.replace(/\s+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim()
}
const NOISE = /^(码住|马住|mark|收藏了?|已收藏|插眼|蹲+|d+|up|顶|cy|好美|太美了?)[!！~。.\s]*$/i
function isNoise(c) {
  const s = stripEmoji(c.content ?? '').replace(/@\S+/g, '').trim()
  return !s || NOISE.test(s)
}

const ymd = (iso) => (iso ? iso.slice(2, 10) : '')
const fmtN = (n) => (n == null ? '?' : n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万` : String(n))

/** 帖子 ID；给了 --topic 时只要这个主题的 */
async function noteIds() {
  const ids = await allIds()
  if (!flags.has('--topic')) return ids
  const t = resolveTopic(await loadTopics(), String(flags.get('--topic')))
  const hit = new Set((await loadTrips()).filter(({ trip }) => trip.topics?.includes(t.id)).map(({ id }) => id))
  say(`（只看主题「${t.name}」的 ${hit.size} 篇）`)
  return ids.filter((id) => hit.has(id))
}

async function resolve(prefix) {
  const ids = await allIds()
  const hit = ids.filter((id) => id.startsWith(prefix))
  if (hit.length === 1) return hit[0]
  console.error(hit.length ? `「${prefix}」对应多篇：${hit.join(' ')}` : `data/notes 里没有以「${prefix}」开头的帖子`)
  process.exit(1)
}

async function atlasLine(id) {
  const p = join(ATLAS, 'trips', `${id}.json`)
  if (!existsSync(p)) return '未整理'
  const t = await readJson(p)
  const n = (k) => (t[k]?.length ? ` · ${k} ${t[k].length}` : '')
  const topics = t.topics?.length ? ` · 主题 ${t.topics.join(' ')}` : ''
  const read = t.read ? ` · ${t.read.at} 读到 ${t.read.comments} 条评论${t.read.ocr ? '和图片文字' : ''}` : ''
  return `trips/${id.slice(0, 8)}….json：${t.kind}${t.days ? ` · ${t.days} 天` : ''}${n('plan')}${n('legs')}${n('notes')}${n('tips')}${topics}${read}`
}

const ocrChars = (d) => (d.ocr ?? []).reduce((s, p) => s + p.lines.join('').length, 0)
const loaded = (d) => d.comments.topLevel + d.comments.replies

/** 这篇还差什么没读：没整理过、整理后又采集到新评论、图片文字多但没读过。都读过了返回空数组 */
async function pending(d) {
  const p = join(ATLAS, 'trips', `${d.id}.json`)
  if (!existsSync(p)) return ['未整理']
  const r = (await readJson(p)).read
  if (!r) return ['没有 read 记录']
  const out = []
  if (loaded(d) > r.comments) out.push(`新评论 +${loaded(d) - r.comments}`)
  if (!r.ocr && ocrChars(d) >= OCR_WORTH) out.push(`图片文字 ${ocrChars(d)} 字没读`)
  if (d.ocr === null) out.push('还没跑 npm run ocr')
  return out
}

function commentLine(c, label, root) {
  const bits = [`[${label}]`, c.user?.nickname ?? '?']
  if (root && c.replyTo && c.replyTo.id !== root.id && c.replyTo.nickname) bits[1] += ` → ${c.replyTo.nickname}`
  const tags = [c.isAuthor && '作者', c.isPinned && '置顶', c.isBot && 'AI'].filter(Boolean)
  if (tags.length) bits.push(`【${tags.join('·')}】`)
  if (c.likeCount) bits.push(`♥${c.likeCount}`)
  if (!BRIEF) {
    if (c.ipLocation) bits.push(c.ipLocation)
    if (c.time) bits.push(ymd(c.time))
    else if (c.timeText) bits.push(c.timeText)
  }
  const pics = c.pictures?.length ? ` [图×${c.pictures.length}]` : ''
  return `${bits.join(' ')}｜${oneLine(c.content)}${pics}`
}

// 每一楼编号固定为它在合并结果里的位置（1 起），筛选、排序后编号不变
function threads(items, o) {
  let list = items.map((c, k) => ({ c, n: k + 1 }))
  let folded = 0, bots = 0
  if (!o.all) {
    list = list.filter(({ c }) => {
      if (c.isBot) { bots++; return false }
      if (isNoise(c) && !(c.subComments?.length)) { folded++; return false }
      return true
    })
  }
  if (o.author) list = list.filter(({ c }) => c.isAuthor || c.subComments?.some((r) => r.isAuthor))
  if (o.minLikes) list = list.filter(({ c }) => (c.likeCount ?? 0) >= o.minLikes)
  if (o.re) list = list.filter(({ c }) => o.re.test(stripEmoji(c.content ?? '')) || c.subComments?.some((r) => o.re.test(stripEmoji(r.content ?? ''))))
  if (o.sort === 'likes') list.sort((a, b) => (b.c.likeCount ?? 0) - (a.c.likeCount ?? 0))
  if (o.top) list = list.slice(0, o.top)
  return { list, folded, bots }
}

function printThread({ c, n }, o) {
  say(commentLine(c, n))
  let subs = (c.subComments ?? []).map((r, j) => ({ r, j }))
  if (!o.all) subs = subs.filter(({ r }) => !r.isBot && !isNoise(r))
  const shown = o.replies != null ? subs.slice(0, o.replies) : subs
  for (const { r, j } of shown) say('  ' + commentLine(r, `${n}.${j + 1}`, c))
  const missing = Math.max(c.subCommentCount ?? 0, c.subComments?.length ?? 0) - (c.subComments?.length ?? 0)
  const hidden = subs.length - shown.length
  const tail = [hidden > 0 && `另有 ${hidden} 条回复未显示`, missing > 0 && `${missing} 条回复没采集`].filter(Boolean)
  if (tail.length) say(`  … ${tail.join('，')}`)
}

function coverage(d) {
  const c = d.comments
  const got = c.topLevel + c.replies
  if (!c.full) return `评论 未登录抓取 ${got}/${fmtN(c.total)}（只有前几楼；完整评论要用插件采集）`
  const top = `一级 ${c.topLevel}/${fmtN(c.topLevelTotal)}${c.topDone ? ' 已到底' : ' 未到底'}`
  return `评论 插件采集 ${got}/${fmtN(c.total)}（${top}${c.pendingThreads ? `，${c.pendingThreads} 楼回复没展开完` : ''}）`
}

async function readOne(id) {
  const d = await loadNote(id)
  const n = d.note
  const imgs = n.images?.length ?? 0
  const live = n.images?.filter((x) => x.livePhoto).length ?? 0
  say(`━━ ${id}  ${n.title}`)
  say(`作者 ${n.author?.nickname} · 发布 ${ymd(n.publishTime)} · 赞 ${fmtN(n.counts?.liked)} 藏 ${fmtN(n.counts?.collected)} 评 ${fmtN(n.counts?.comment)} · 图 ${imgs} 张${live ? `（Live ${live}）` : ''}${n.type === 'video' ? ' · 视频' : ''}`)
  if (n.tags?.length) say(`话题 ${n.tags.join(' · ')}`)
  say(`atlas ${await atlasLine(id)}`)
  say(coverage(d))
  if (imgs) say(`图片 data/notes/${id}/images/（${n.images.map((x) => x.local?.split('/').pop()).filter(Boolean).slice(0, 1)[0] ?? ''} 起）`)

  if (!flags.has('--no-desc')) {
    const desc = cleanDesc(n.desc)
    say('')
    say(`── 正文（${desc.length} 字）`)
    say(desc || '（无正文）')
  }
  if (!flags.has('--no-ocr')) {
    say('')
    if (d.ocr === null) say('── 图片文字：还没识别（npm run ocr）')
    else if (!d.ocr.length) say(`── 图片文字：${imgs} 张图里没有成段的文字`)
    else {
      say(`── 图片文字（${imgs} 张里 ${d.ocr.length} 张有字，${ocrChars(d)} 字；机器识别，可能有错字、顺序可能乱）`)
      for (const p of d.ocr) say(`[图${p.img}] ${oneLine(p.lines.join('\n'))}`)
    }
  }
  if (flags.has('--no-comments')) return

  const o = {
    all: flags.has('--all'),
    author: flags.has('--author'),
    minLikes: Number(flags.get('--min-likes') ?? 0),
    re: flags.has('--grep') ? new RegExp(flags.get('--grep'), 'i') : null,
    sort: flags.get('--sort'),
    top: flags.has('--top') ? Number(flags.get('--top')) : null,
    replies: flags.has('--replies') ? Number(flags.get('--replies')) : null,
  }
  const { list, folded, bots } = threads(d.items, o)
  const shownReplies = list.reduce((s, t) => s + (t.c.subComments?.length ?? 0), 0)
  const note = [folded && `折叠 ${folded} 条无内容评论`, bots && `折叠 ${bots} 条 AI 助手回复`].filter(Boolean)
  say('')
  say(`── 评论（显示 ${list.length} 楼、${shownReplies} 条回复${note.length ? `；${note.join('，')}，--all 显示` : ''}）`)
  for (const t of list) printThread(t, o)
  if (!list.length) say('（没有符合条件的评论）')
}

async function list(onlyTodo) {
  const ids = await noteIds()
  if (!onlyTodo) say(`共 ${ids.length} 篇。列：ID 前 8 位 · 评论已有/总数（✓ 插件采集且翻完，~ 插件采集未翻完，- 未登录前几条）· 图 · 正文字数 · 图片文字字数 · 状态 · 标题`)
  const rows = []
  for (const id of ids) {
    const d = await loadNote(id)
    const c = d.comments
    const todo = await pending(d)
    if (onlyTodo && !todo.length) continue
    const mark = !c.full ? '-' : c.complete ? '✓' : '~'
    const cm = `${mark}${loaded(d)}/${fmtN(c.total)}`.padEnd(10)
    const state = todo.length ? todo.join('，') : '已读完'
    rows.push({ todo, line: `${id.slice(0, 8)}  ${cm} 图${String(d.note.images?.length ?? 0).padStart(3)}  ${String(cleanDesc(d.note.desc).length).padStart(5)}字  图字${String(ocrChars(d)).padStart(5)}  ${state}  ${d.note.title}` })
  }
  for (const r of rows) say(r.line)
  const n = rows.filter((r) => r.todo.length).length
  if (onlyTodo) say(n ? `\n${n} 篇要读。整理完运行 npm run -s read -- done <id …> 记下读到了哪` : '全部读完了')
  else if (n) say(`\n${n} 篇要读，npm run -s read -- todo 只列这些`)
}

/** 在 trips/<id>.json 里写上 read 字段。只改这一行，不重排文件里别的内容 */
async function done(prefixes) {
  const today = new Date().toISOString().slice(0, 10)
  for (const id of await Promise.all(prefixes.map(resolve))) {
    const p = join(ATLAS, 'trips', `${id}.json`)
    if (!existsSync(p)) { console.error(`${id}：还没有 atlas/trips/${id}.json，先整理再标记`); process.exitCode = 1; continue }
    const d = await loadNote(id)
    const read = { at: today, comments: loaded(d), ocr: d.ocr !== null }
    const line = `"read": ${JSON.stringify(read).replace(/^\{/, '{ ').replace(/\}$/, ' }').replace(/,"/g, ', "').replace(/":/g, '": ')}`
    let text = await readFile(p, 'utf8')
    text = /"read": \{[^}]*\}/.test(text) ? text.replace(/"read": \{[^}]*\}/, line) : text.replace(/^\{\n/, `{\n  ${line},\n`)
    JSON.parse(text) // 改坏了就别写
    await writeFile(p, text)
    say(`${id.slice(0, 8)}  ${line}`)
  }
}

async function grep(pattern, prefixes) {
  const re = new RegExp(pattern, 'i')
  const ids = prefixes.length ? await Promise.all(prefixes.map(resolve)) : await noteIds()
  let hits = 0, notes = 0
  for (const id of ids) {
    const d = await loadNote(id)
    const lines = []
    cleanDesc(d.note.desc).split('\n').forEach((l, k) => { if (re.test(l)) lines.push(`  正文 L${k + 1}｜${l.trim()}`) })
    for (const p of d.ocr ?? []) {
      const hit = p.lines.filter((l) => re.test(l))
      if (hit.length) lines.push(`  图${p.img}｜${hit.join(' / ')}`)
    }
    d.items.forEach((c, k) => {
      const rootHit = re.test(stripEmoji(c.content ?? ''))
      const subHits = (c.subComments ?? []).map((r, j) => ({ r, j })).filter(({ r }) => re.test(stripEmoji(r.content ?? '')))
      if (!rootHit && !subHits.length) return
      // 回复命中时也带上楼主那一条，否则看不懂在回什么
      lines.push('  ' + commentLine(c, k + 1))
      for (const { r, j } of subHits) lines.push('    ' + commentLine(r, `${k + 1}.${j + 1}`, c))
    })
    if (!lines.length) continue
    notes++
    hits += lines.length
    say(`── ${id.slice(0, 8)}  ${d.note.title}`)
    lines.forEach((l) => say(l))
  }
  say(`\n${notes} 篇、${hits} 行命中 /${pattern}/`)
}

const [cmd, ...rest] = pos
if (!cmd) {
  console.error('用法：xhs-read.mjs list | todo | <id> [选项] | grep <正则> [id …] | done <id …>。详见文件开头的注释')
  process.exit(1)
}
if (cmd === 'list') await list(false)
else if (cmd === 'todo') await list(true)
else if (cmd === 'done') {
  if (!rest.length) { console.error('done 需要至少一个帖子 ID'); process.exit(1) }
  await done(rest)
} else if (cmd === 'grep') {
  if (!rest[0]) { console.error('grep 需要一个正则'); process.exit(1) }
  await grep(rest[0], rest.slice(1))
} else for (const p of [cmd, ...rest]) { await readOne(await resolve(p)); say('') }
flush()
