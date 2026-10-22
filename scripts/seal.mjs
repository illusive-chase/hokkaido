#!/usr/bin/env node
// 把 atlas/ 和 local/ 加密成 public/vault/。仓库是公开的，部署出去的网页只有这些密文：
//   public/vault/meta.json      盐和迭代次数（公开）
//   public/vault/atlas.bin      atlas/ 整个目录拼成的一份
//   public/vault/m/<名字>.bin   local/ 里的每张图、每篇原文各一个文件
// 格式见 scripts/lib/vault.mjs。密码读环境变量 VAULT_KEY，没有就读仓库根目录的 .vault-key（不进 git）。
//
// 用法：node scripts/seal.mjs [--rekey]
//   --rekey  换一个新的盐（换密码时用）；所有文件名都会变

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { validate } from './check-atlas.mjs'
import { ATLAS, readJson, ROOT } from './lib/notes.mjs'
import { blobName, deriveKeys, ITER, open, readAtlas, seal } from './lib/vault.mjs'

const VAULT = join(ROOT, 'public/vault')
const LOCAL = join(ROOT, 'local')
const KEY_FILE = join(ROOT, '.vault-key')

async function password() {
  if (process.env.VAULT_KEY) return process.env.VAULT_KEY
  if (existsSync(KEY_FILE)) return (await readFile(KEY_FILE, 'utf8')).trim()
  throw new Error('没有密码：写进仓库根目录的 .vault-key（不进 git），或者设环境变量 VAULT_KEY')
}

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

/** 内容没变就不写 */
async function put(file, buf) {
  if (existsSync(file) && (await readFile(file)).equals(buf)) return false
  await writeFile(file, buf)
  return true
}

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`

async function main() {
  if (!existsSync(join(ATLAS, 'areas.json'))) throw new Error('atlas/ 是空的：先 git submodule update --init 拉下私有仓库')
  const problems = await validate()
  if (problems.length) {
    console.error(`atlas 校验发现 ${problems.length} 个问题，没有加密：`)
    for (const p of problems) console.error('  - ' + p)
    process.exit(1)
  }

  const metaPath = join(VAULT, 'meta.json')
  const old = existsSync(metaPath) ? await readJson(metaPath) : null
  const meta = old && !process.argv.includes('--rekey') ? old : { v: 1, iter: ITER, salt: randomBytes(16).toString('base64') }
  const keys = deriveKeys(await password(), Buffer.from(meta.salt, 'base64'), meta.iter)
  await mkdir(join(VAULT, 'm'), { recursive: true })
  await put(metaPath, Buffer.from(JSON.stringify(meta) + '\n'))

  const plain = Buffer.from(JSON.stringify(await readAtlas()))
  const sealed = seal(keys, 'atlas.json', plain)
  if (!open(keys, 'atlas.json', sealed).equals(plain)) throw new Error('atlas.bin 解不回原文')
  const changed = await put(join(VAULT, 'atlas.bin'), sealed)
  console.log(`public/vault/atlas.bin：${mb(sealed.length)}${changed ? '，已更新' : '，没有变化'}`)

  if (!existsSync(LOCAL)) {
    console.warn('! 没有 local/（先 npm run data），图片和原文沿用 public/vault/m 里已有的')
    return
  }
  const keep = new Set()
  let written = 0, same = 0, bytes = 0
  for await (const f of walk(LOCAL)) {
    const path = relative(LOCAL, f).split(sep).join('/')
    const name = `${blobName(keys, path)}.bin`
    keep.add(name)
    const buf = seal(keys, path, await readFile(f))
    bytes += buf.length
    if (await put(join(VAULT, 'm', name), buf)) written++
    else same++
  }
  let removed = 0
  for (const f of await readdir(join(VAULT, 'm'))) {
    if (keep.has(f)) continue
    await rm(join(VAULT, 'm', f))
    removed++
  }
  console.log(`public/vault/m：${keep.size} 个文件，${mb(bytes)}；新写 ${written}，没变 ${same}，删掉 ${removed}`)
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
