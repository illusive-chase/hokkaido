import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { boot, unlock } from './vault'

// App 和它用到的数据模块在解锁以后才加载：它们在模块顶层就要读 atlas
const App = lazy(() => import('./App'))

type Stage = 'boot' | 'locked' | 'open' | 'error'

export default function Gate() {
  const [stage, setStage] = useState<Stage>('boot')
  const [err, setErr] = useState('')
  useEffect(() => {
    boot().then((ok) => setStage(ok ? 'open' : 'locked')).catch((e) => { setErr(String(e?.message ?? e)); setStage('error') })
  }, [])
  if (stage === 'open') return <Suspense fallback={<Splash text="正在打开…" />}><App /></Suspense>
  if (stage === 'locked') return <Unlock onOpen={() => setStage('open')} />
  if (stage === 'error') return <Splash text={`读不到数据：${err}`} />
  return <Splash text="正在打开…" />
}

function Splash({ text }: { text: string }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>雪国手帖</h1>
        <p className="muted small">{text}</p>
      </div>
    </div>
  )
}

function Unlock({ onOpen }: { onOpen: () => void }) {
  const [pw, setPw] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true)
    setWrong(false)
    try {
      if (await unlock(pw, remember)) return onOpen()
      setWrong(true)
    } catch {
      setWrong(true)
    }
    setBusy(false)
  }
  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <h1>雪国手帖</h1>
        <p className="muted small">内容已加密，输入密码后在这台设备上解密。</p>
        <input
          className="search" type="password" autoComplete="current-password" autoFocus
          placeholder="密码" value={pw} onChange={(e) => { setPw(e.target.value); setWrong(false) }}
          aria-invalid={wrong} aria-describedby="gate-msg"
        />
        <label className="toggle">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          在这台设备上记住
        </label>
        <button className="gate-go" type="submit" disabled={!pw || busy}>{busy ? '解密中…' : '打开'}</button>
        <p id="gate-msg" className="gate-msg" role="alert">{wrong ? '密码不对' : ''}</p>
      </form>
    </div>
  )
}
