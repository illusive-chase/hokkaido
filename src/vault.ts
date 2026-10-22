// 网页的数据从哪来。仓库和网页都是公开的，部署出去的只有 public/vault/ 里的密文（scripts/seal.mjs 生成，格式见 scripts/lib/vault.mjs）：
// 打开网页先输密码，用 WebCrypto 解开 atlas.bin；图片和原文用到的时候再逐个下载、解密。
// 开发时（npm run dev）vite.config.ts 直接提供 atlas/ 和 local/ 的明文，不用输密码；atlas/ 没拉下来时也走密文。
import type { Area, Place, Region, SgPlan, Source, TripAnno } from './types'

/** atlas/ 整个目录拼成的一份，和 scripts/lib/vault.mjs 的 readAtlas 一致 */
export interface AtlasData {
  areas: { regions: Region[]; areas: Area[]; themes: string[] }
  places: Record<string, Place[]>
  trips: Record<string, TripAnno>
  plans: Record<string, Omit<SgPlan, 'id'>>
  sources: Record<string, Source>
}

interface Meta { v: number; iter: number; salt: string }
interface Keys { aes: CryptoKey; mac: CryptoKey }

const BASE = import.meta.env.BASE_URL
/** 记住的密钥（推导好的 64 字节）和对应的盐；换了密码、盐变了就作废 */
const REMEMBER = 'hk.vault'
const utf8 = new TextEncoder()

let data: AtlasData | null = null
/** null：明文（开发时） */
let keys: Keys | null = null

/** App 在解锁以后才加载，所以 data.ts、plan.ts 在模块顶层就能拿到 */
export function atlas(): AtlasData {
  if (!data) throw new Error('atlas 还没解锁')
  return data
}
/** 数据是不是从密文解出来的（这时才有「锁上」按钮） */
export const sealed = () => keys !== null

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))

async function get(url: string) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}：HTTP ${r.status}`)
  return r
}
let metaP: Promise<Meta> | null = null
const meta = () => (metaP ??= get(`${BASE}vault/meta.json`).then((r) => r.json()))
let atlasP: Promise<ArrayBuffer> | null = null
const atlasBin = () => (atlasP ??= get(`${BASE}vault/atlas.bin`).then((r) => r.arrayBuffer()))

async function derive(password: string, m: Meta) {
  const base = await crypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(m.salt), iterations: m.iter }, base, 512))
}

async function importKeys(bits: Uint8Array): Promise<Keys> {
  return {
    aes: await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['decrypt']),
    mac: await crypto.subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  }
}

/** iv(12) ‖ 密文 ‖ tag(16)；WebCrypto 要的正好是「密文 ‖ tag」 */
const open = (k: Keys, path: string, buf: ArrayBuffer) =>
  crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12), additionalData: utf8.encode(path) }, k.aes, buf.slice(12))

/** 用这组密钥解 atlas.bin；密钥不对返回 false */
async function tryKeys(bits: Uint8Array) {
  const k = await importKeys(bits)
  let plain: ArrayBuffer
  try {
    plain = await open(k, 'atlas.json', await atlasBin())
  } catch {
    return false
  }
  data = JSON.parse(new TextDecoder().decode(plain))
  keys = k
  return true
}

function saved(): { salt: string; key: string } | null {
  try { return JSON.parse(localStorage.getItem(REMEMBER) ?? 'null') } catch { return null }
}
export function forget() {
  try { localStorage.removeItem(REMEMBER) } catch { /* 隐私模式下忽略 */ }
}

let bootP: Promise<boolean> | null = null
/** 打开网页时：开发时读明文，否则试这台设备记住的密钥。返回 false 就要输密码 */
export const boot = () => (bootP ??= (async () => {
  if (import.meta.env.DEV) {
    const r = await fetch(`${BASE}__atlas`).catch(() => null)
    if (r?.ok) { data = await r.json(); return true }
  }
  const m = await meta()
  const s = saved()
  if (s && s.salt === m.salt && (await tryKeys(b64(s.key)))) return true
  if (s) forget()
  return false
})())

/** 输密码解锁；密码不对返回 false。remember：把推导好的密钥存在这台设备上，下次不用再输 */
export async function unlock(password: string, remember: boolean) {
  const m = await meta()
  const bits = await derive(password, m)
  if (!(await tryKeys(bits))) return false
  if (remember) {
    try { localStorage.setItem(REMEMBER, JSON.stringify({ salt: m.salt, key: toB64(bits) })) } catch { /* 隐私模式下忽略 */ }
  }
  return true
}

// —— local/ 里的图片（img/、thumb/）和原文（text/） ——

async function blobName(k: Keys, path: string) {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k.mac, utf8.encode(`name:${path}`)))
  return [...sig.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 读 local/ 里的一个文件，没有就返回 null */
export async function localFile(path: string): Promise<Blob | null> {
  if (!keys) {
    const r = await fetch(`${BASE}local/${path}`)
    return r.ok ? r.blob() : null
  }
  const k = keys
  const r = await fetch(`${BASE}vault/m/${await blobName(k, path)}.bin`)
  if (!r.ok) return null
  const type = path.endsWith('.json') ? 'application/json' : 'image/jpeg'
  try { return new Blob([await open(k, path, await r.arrayBuffer())], { type }) } catch { return null }
}

const mediaP = new Map<string, Promise<string | null>>()
const mediaDone = new Map<string, string | null>()

/** 已经能直接用的图片地址：明文时就是 URL；密文时解过的是 blob URL，还没解的是 undefined，没有这张图是 null */
export function knownMedia(path: string): string | null | undefined {
  return keys ? mediaDone.get(path) : `${BASE}local/${path}`
}

/** 图片的地址：密文时下载、解密成 blob URL，同一张只解一次 */
export function mediaUrl(path: string): Promise<string | null> {
  const known = knownMedia(path)
  if (known !== undefined) return Promise.resolve(known)
  let p = mediaP.get(path)
  if (!p) {
    p = localFile(path)
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null)
      .then((u) => { mediaDone.set(path, u); return u })
    mediaP.set(path, p)
  }
  return p
}
