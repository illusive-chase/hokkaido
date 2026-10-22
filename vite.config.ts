import { createReadStream, existsSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readAtlas } from './scripts/lib/vault.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const ATLAS = join(ROOT, 'atlas')
const LOCAL = join(ROOT, 'local')

/** 开发时直接提供 atlas/ 和 local/ 的明文，不用输密码；部署出去的只有 public/vault/ 的密文（src/vault.ts） */
function plainData(): Plugin {
  return {
    name: 'hokkaido-plain-data',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(ATLAS)
      server.watcher.on('change', (f) => { if (f.startsWith(ATLAS + sep)) server.ws.send({ type: 'full-reload' }) })
      server.middlewares.use('/__atlas', async (_req, res) => {
        if (!existsSync(join(ATLAS, 'areas.json'))) { res.statusCode = 404; return res.end() }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(await readAtlas(ATLAS)))
      })
      server.middlewares.use('/local', (req, res) => {
        const file = normalize(join(LOCAL, decodeURIComponent((req.url ?? '').split('?')[0])))
        if (!file.startsWith(LOCAL + sep) || !existsSync(file)) { res.statusCode = 404; return res.end() }
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'image/jpeg')
        createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), plainData()],
  server: {
    port: 5280,
    strictPort: false,
    // 前几项是 vite 的默认值；.vault-key 是加密密码，不让开发服务器返回
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '.vault-key'] },
  },
})
