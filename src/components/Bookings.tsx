import { useEffect, useMemo, useState } from 'react'
import type { SgBooking, SgDay, SgPlan, SgTodo } from '../types'
import { Booking, fmtDay } from './Plan'

const KEY = 'hk.todo'
/** 勾选状态只存本机：仓库是公开的，也没有后端 */
export function useTodoDone() {
  const [done, setDone] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]) } catch { return new Set() }
  })
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify([...done])) } catch { /* 隐私模式下忽略 */ }
  }, [done])
  const toggle = (id: string) => setDone((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return { done, toggle }
}

/** 「1/5」 */
const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`
/** 本机日期 YYYY-MM-DD；截止时间按当地时间写，和本机时区差几个小时不影响按天比较 */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** 所有已订、在订：机票、酒店、餐厅、接驳车；连住的几晚只列一次 */
function bookingsOf(plan: SgPlan) {
  const out: { d: SgDay; b: SgBooking; kind: string }[] = []
  plan.days.forEach((d, i) => {
    if (d.move?.booking) out.push({ d, b: d.move.booking, kind: '交通' })
    if (d.stayBooking && plan.days[i - 1]?.stayBooking?.what !== d.stayBooking.what) out.push({ d, b: d.stayBooking, kind: '住' })
    for (const s of d.slots) if (s.booking) out.push({ d, b: s.booking, kind: '餐厅' })
  })
  return out
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1600) } catch { /* 不支持就算了 */ }
  }
  return <button className="copy" onClick={copy}>{ok ? '已复制 ✓' : '复制草稿'}</button>
}

function TodoItem({ t, plan, done, onToggle, onDay }: { t: SgTodo; plan: SgPlan; done: boolean; onToggle: () => void; onDay: (d: number) => void }) {
  const [open, setOpen] = useState(false)
  const d = t.day != null ? plan.days.find((x) => x.day === t.day) : null
  const late = !done && t.by && t.by < today()
  return (
    <li className={`todo ${done ? 'done' : ''}`}>
      <label className="todo-h">
        <input type="checkbox" checked={done} onChange={onToggle} />
        <span className="todo-title">{t.title}</span>
      </label>
      <div className="todo-meta">
        {t.by && <span className={late ? 'late' : ''}>{late ? '已过 ' : '最晚 '}{md(t.by)}</span>}
        {d && <button className="link" onClick={() => onDay(d.day)}>D{d.day}{d.date && ` · ${fmtDay(d.date)}`}</button>}
        {t.tel && <a href={`tel:+81${t.tel.replace(/^0/, '').replace(/-/g, '')}`}>☎ {t.tel}</a>}
        {t.links?.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer">{l.name} ↗</a>)}
      </div>
      {t.text && <p className="todo-text">{t.text}</p>}
      {t.ask && t.ask.length > 0 && (
        <ul className="todo-ask">{t.ask.map((a, k) => <li key={k}>{a}</li>)}</ul>
      )}
      {t.draft && (
        <div className="draft">
          <div className="draft-h">
            <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '收起日文草稿' : '看日文草稿'}</button>
            <CopyBtn text={t.draft} />
          </div>
          {open && <pre>{t.draft}</pre>}
        </div>
      )}
    </li>
  )
}

/** 预订 · 待办：已订和在订的清单、免费取消截止、要发的邮件、其他待办。浮在地图上的单独窗口 */
export default function Bookings({ plan, done, onToggle, onDay, onClose }: {
  plan: SgPlan
  done: Set<string>
  onToggle: (id: string) => void
  onDay: (d: number) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'todo' | 'booked'>('todo')
  const list = useMemo(() => bookingsOf(plan), [plan])
  const todos = plan.todos ?? []
  const byDate = (a: SgTodo, b: SgTodo) => (a.by ?? '9999').localeCompare(b.by ?? '9999') || (a.day ?? 99) - (b.day ?? 99)
  const mails = todos.filter((t) => t.kind === 'mail').sort(byDate)
  const tasks = todos.filter((t) => t.kind === 'task').sort(byDate)
  const left = todos.filter((t) => !done.has(t.id)).length
  const deadlines = list.filter(({ b }) => b.free).sort((x, y) => x.b.free!.localeCompare(y.b.free!))

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])

  return (
    <div className="bk" role="dialog" aria-label="预订 · 待办">
      <header className="bk-h">
        <h2>预订 · 待办</h2>
        <nav className="bk-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'todo'} className={tab === 'todo' ? 'on' : ''} onClick={() => setTab('todo')}>待办 <small>{left}/{todos.length}</small></button>
          <button role="tab" aria-selected={tab === 'booked'} className={tab === 'booked' ? 'on' : ''} onClick={() => setTab('booked')}>已订 · 在订 <small>{list.length}</small></button>
        </nav>
        <button className="bk-close" onClick={onClose} aria-label="关闭">×</button>
      </header>
      <div className="bk-body">
        {tab === 'todo' ? (
          <>
            <section className="bk-sec">
              <h3>邮件确认 <small>每封都有要问的事和日文草稿，〈 〉里自己填；勾选只存在这台设备上</small></h3>
              <ol className="todos">{mails.map((t) => <TodoItem key={t.id} t={t} plan={plan} done={done.has(t.id)} onToggle={() => onToggle(t.id)} onDay={onDay} />)}</ol>
            </section>
            <section className="bk-sec">
              <h3>要订、要约的</h3>
              <ol className="todos">{tasks.map((t) => <TodoItem key={t.id} t={t} plan={plan} done={done.has(t.id)} onToggle={() => onToggle(t.id)} onDay={onDay} />)}</ol>
            </section>
          </>
        ) : (
          <>
            {deadlines.length > 0 && (
              <section className="bk-sec">
                <h3>免费取消截止 <small>当地时间，过了就按比例或全额收费</small></h3>
                <ul className="deadlines">
                  {deadlines.map(({ d, b }, k) => (
                    <li key={k} className={b.free!.slice(0, 10) < today() ? 'past' : ''}>
                      <span className="dl-when">{b.free}</span>
                      <span>{b.what.split(' · ')[0]}</span>
                      <button className="link" onClick={() => onDay(d.day)}>D{d.day}</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="bk-sec">
              <h3>清单</h3>
              <ul className="bookings">
                {list.map(({ d, b, kind }, k) => (
                  <li key={k}>
                    <button className="link" onClick={() => onDay(d.day)}>D{d.day}{d.date && ` · ${fmtDay(d.date)}`}<small>{kind}</small></button>
                    <Booking b={b} />
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
