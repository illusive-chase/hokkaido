// 公开部署用的加密。密码 → PBKDF2-SHA256 → 64 字节：前 32 字节是 AES-256-GCM 的密钥，后 32 字节是 HMAC 的密钥。
// 网页（src/vault.ts）用 WebCrypto 做同样的推导和解密，两边的格式要一致：
//   文件名  HMAC(mac, "name:" + 路径) 的前 16 字节（hex），不暴露帖子 ID
//   密文    iv(12) ‖ AES-GCM(明文，附加数据 = 路径) ‖ tag(16)
//   iv      HMAC(mac, "iv:" + 路径 + "\0" + 明文) 的前 12 字节：内容不变密文就不变，git 里只有真正改过的文件会变
import { createCipheriv, createDecipheriv, createHmac, pbkdf2Sync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ATLAS, readJson } from './notes.mjs'

export const ITER = 600_000

export function deriveKeys(password, salt, iter = ITER) {
  const k = pbkdf2Sync(password, salt, iter, 64, 'sha256')
  return { enc: k.subarray(0, 32), mac: k.subarray(32) }
}

export const blobName = (keys, path) => createHmac('sha256', keys.mac).update(`name:${path}`).digest('hex').slice(0, 32)

export function seal(keys, path, plain) {
  const iv = createHmac('sha256', keys.mac).update(`iv:${path}\0`).update(plain).digest().subarray(0, 12)
  const c = createCipheriv('aes-256-gcm', keys.enc, iv)
  c.setAAD(Buffer.from(path))
  const body = Buffer.concat([c.update(plain), c.final()])
  return Buffer.concat([iv, body, c.getAuthTag()])
}

export function open(keys, path, buf) {
  const d = createDecipheriv('aes-256-gcm', keys.enc, buf.subarray(0, 12))
  d.setAAD(Buffer.from(path))
  d.setAuthTag(buf.subarray(buf.length - 16))
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()])
}

/** atlas/ 整个目录拼成一份：开发服务器直接返回它，npm run seal 把它加密成 public/vault/atlas.bin */
export async function readAtlas(dir = ATLAS) {
  const folder = async (sub) => {
    if (!existsSync(join(dir, sub))) return {}
    const files = (await readdir(join(dir, sub))).filter((f) => f.endsWith('.json')).sort()
    return Object.fromEntries(await Promise.all(files.map(async (f) => [f.slice(0, -5), await readJson(join(dir, sub, f))])))
  }
  return {
    areas: await readJson(join(dir, 'areas.json')),
    places: await folder('places'),
    trips: await folder('trips'),
    plans: await folder('plans'),
    sources: existsSync(join(dir, 'sources.json')) ? await readJson(join(dir, 'sources.json')) : {},
  }
}
