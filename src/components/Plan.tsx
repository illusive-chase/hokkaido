import { useMemo } from 'react'
import { placeById } from '../data'
import { ALT_META, altKey, altSpot, effDay, gmapPlace, gmapRide, refTrip, SLOT_LABEL, type EffDay } from '../plan'
import { areaName, MODE_LABEL } from '../transit'
import type { AltKind, SgAlt, SgBooking, SgDay, SgLink, SgPlan, SgRide } from '../types'
import { Section } from './bits'
import { ModeTags } from './Transit'

/** 出处：帖子作者，点开看原帖；官网等外部出处在新窗口打开，标出查阅日期 */
export function Refs({ refs, links, onTrip }: { refs?: string[]; links?: SgLink[]; onTrip: (id: string) => void }) {
  const list = (refs ?? []).map(refTrip).filter((t): t is NonNullable<typeof t> => !!t)
  if (!list.length && !links?.length) return null
  return (
    <span className="refs">
      <small>出处</small>
      {list.map((t) => (
        <button key={t.id} className="ref" onClick={() => onTrip(t.id)} title={t.src.title}>{t.src.author}</button>
      ))}
      {links?.map((l) => (
        <a key={l.url} className="ref" href={l.url} target="_blank" rel="noreferrer" title={`${l.date} 查阅`}>{l.name} ↗</a>
      ))}
    </span>
  )
}

/** 已订 / 在订：写订的是什么，不写姓名、订单号 */
export function Booking({ b, compact }: { b?: SgBooking; compact?: boolean }) {
  if (!b) return null
  return (
    <p className={`booking booking-${b.status}`}>
      <b>{b.status === 'booked' ? '已订' : '在订'}</b>
      <span>
        {b.what}
        {!compact && b.free && <small className="booking-free">免费取消截止 {b.free}（当地时间）</small>}
        {!compact && b.note && <small>{b.note}</small>}
      </span>
    </p>
  )
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六']
/** 「1/5 周一」 */
export const fmtDay = (date?: string) => {
  if (!date) return ''
  const d = new Date(`${date}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} 周${WEEK[d.getUTCDay()]}`
}
const shortDate = (date?: string) => (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : '')

export function AltMark({ kind }: { kind: AltKind }) {
  const m = ALT_META[kind]
  return <span className={`alt-mark alt-${kind}`} aria-label={m.label} title={m.label}>{m.icon}</span>
}

const Stops = ({ ids, onPlace }: { ids: string[]; onPlace: (id: string) => void }) => (
  <div className="stops">
    {ids.map((id, k) => {
      const p = placeById.get(id)
      if (!p) return null
      return p.offmap
        ? <span key={k} className={`stop stop-${p.kind} stop-off`}>{p.name}</span>
        : <button key={k} className={`stop stop-${p.kind}`} onClick={() => onPlace(id)}>{p.name}</button>
    })}
  </div>
)

/** 谷歌地图的小按钮，新窗口打开 */
const GMap = ({ href, label }: { href: string; label: string }) => (
  <a className="gmap" href={href} target="_blank" rel="noreferrer" aria-label={label} title={label}>
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M6 11s3.6-3.4 3.6-6.1A3.6 3.6 0 0 0 2.4 4.9C2.4 7.6 6 11 6 11Z" /><circle cx="6" cy="4.9" r="1.2" />
    </svg>
    地图
  </a>
)

/** 当天实际走的每个时段（换成备选的显示备选），给时间轴和单日详情共用 */
const useEff = (plan: SgPlan, picked: Set<string>) => useMemo(() => new Map(plan.days.map((d) => [d.day, effDay(d, picked)])), [plan, picked])

/**
 * 全程时间轴：一行一天，三列是上午、下午、傍晚。
 * 换成备选的格子直接显示备选的内容、标上天气图标；还有备选可选的格子挂一个小点。
 */
function Timeline({ plan, eff, day, onDay, onHoverDay }: {
  plan: SgPlan
  eff: Map<number, EffDay>
  day: number | null
  onDay: (d: number) => void
  onHoverDay: (d: number | null) => void
}) {
  return (
    <ol className="tl" aria-label="逐日时间轴">
      <li className="tl-head" aria-hidden>
        <span />
        {(['am', 'pm', 'eve'] as const).map((s) => <span key={s}>{SLOT_LABEL[s]}</span>)}
        <span>住</span>
      </li>
      {plan.days.map((d) => {
        const e = eff.get(d.day)!
        const hasAlts = !!d.alts?.length || d.slots.some((s) => s.alts?.length)
        return (
          <li key={d.day} className={`tl-row ${day === d.day ? 'on' : ''} ${e.dayAlt ? 'swapped' : ''}`}>
            <button className="tl-btn" onClick={() => onDay(d.day)} onMouseEnter={() => onHoverDay(d.day)} onMouseLeave={() => onHoverDay(null)}
              aria-label={`第 ${d.day} 天${d.date ? `（${fmtDay(d.date)}）` : ''}：${d.title}`}>
              <span className="tl-day">
                <b>D{d.day}</b>
                {d.date && <small className="tl-date">{shortDate(d.date)}</small>}
                {d.move && <small><ModeTags modes={d.move.mode.slice(0, 1)} /></small>}
              </span>
              {(['am', 'pm', 'eve'] as const).map((sl) => {
                const items = e.slots.filter((s) => s.slot.slot === sl)
                if (!items.length) return <span key={sl} className="tl-cell empty" />
                // 整天换掉时，同一个备选只在第一格写一次
                return (
                  <span key={sl} className="tl-cell">
                    {items.map((s) => (
                      <span key={s.i} className={`tl-item ${s.alt ? 'swapped' : ''}`}>
                        {s.alt
                          ? e.dayAlt && s.i > 0 ? <span className="tl-cont">〃</span> : <><AltMark kind={s.alt.kind} />{s.alt.short}</>
                          : s.slot.short}
                      </span>
                    ))}
                  </span>
                )
              })}
              <span className="tl-stay">
                {d.stay ? d.short : '—'}
                {hasAlts && <i className="tl-has-alt" title="这一天有备选" aria-label="有备选" />}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** 住宿的分段条：一段是连住的几晚，长度按晚数 */
function StayBar({ plan, day }: { plan: SgPlan; day: number | null }) {
  const runs: { area: string; from: number; n: number; status?: SgBooking['status'] }[] = []
  for (const d of plan.days) {
    if (!d.stay) continue
    const area = placeById.get(d.stay)?.area ?? d.stay
    const last = runs[runs.length - 1]
    if (last && last.area === area) last.n++
    else runs.push({ area, from: d.day, n: 1, status: d.stayBooking?.status })
  }
  const total = runs.reduce((s, r) => s + r.n, 0)
  return (
    <div className="staybar" role="list" aria-label="住宿">
      {runs.map((r) => (
        <span key={r.from} role="listitem" style={{ flexGrow: r.n }} className={`${day != null && day >= r.from && day < r.from + r.n ? 'on' : ''} ${r.status ? `st-${r.status}` : ''}`}>
          <b>{areaName(r.area)}</b><small>{r.n} 晚{r.status === 'booked' ? ' · 已订' : r.status === 'pending' ? ' · 在订' : ''}</small>
        </span>
      ))}
      <span className="staybar-n" aria-hidden>{total} 晚</span>
    </div>
  )
}

const ALT_ORDER: AltKind[] = ['snow', 'cloud', 'nosnow', 'sunny', 'makeup']

/** 建议路线的总览：偏好、住宿条、逐日时间轴、应变规则。已订和待办在单独的窗口里 */
export function PlanOverview({ plan, picked, day, onDay, onHoverDay, onTrip, onReset, onBookings, todoLeft }: {
  plan: SgPlan
  picked: Set<string>
  day: number | null
  onDay: (d: number) => void
  onHoverDay: (d: number | null) => void
  onTrip: (id: string) => void
  onReset: () => void
  onBookings: () => void
  /** 还没办完的待办数 */
  todoLeft: number
}) {
  const eff = useEff(plan, picked)
  const kinds = useMemo(() => {
    const s = new Set<AltKind>()
    for (const d of plan.days) {
      for (const a of d.alts ?? []) s.add(a.kind)
      for (const sl of d.slots) for (const a of sl.alts ?? []) s.add(a.kind)
    }
    return ALT_ORDER.filter((k) => s.has(k))
  }, [plan])
  const nAlts = plan.days.reduce((n, d) => n + (d.alts?.length ?? 0) + d.slots.reduce((m, s) => m + (s.alts?.length ?? 0), 0), 0)
  const nBooked = plan.days.filter((d, i) => d.stayBooking?.status === 'booked' && plan.days[i - 1]?.stay !== d.stay).length

  return (
    <div className="detail plan">
      <header className="detail-h">
        <div className="kicker">建议路线 · 综合 {new Set(plan.days.flatMap((d) => [...d.slots.flatMap((s) => [...(s.refs ?? []), ...(s.alts ?? []).flatMap((a) => a.refs ?? [])]), ...(d.move?.refs ?? []), ...(d.stayRefs ?? [])])).size} 篇帖子和评论</div>
        <h2>{plan.title}</h2>
        <p className="lede">{plan.summary}</p>
        <dl className="facts">
          {plan.prefs.map((p) => <div key={p.q} className="facts-row"><dt>{p.q}</dt><dd>{p.a}</dd></div>)}
        </dl>
      </header>

      <Section title="住宿" aside={<button className="link aside-btn" onClick={onBookings}>预订 · 待办{todoLeft > 0 && <i className="count-badge">{todoLeft}</i>}</button>}>
        <StayBar plan={plan} day={day} />
        <p className="aside staybar-foot">{nBooked} 家已订；取消截止、要发的邮件和其他待办在「预订 · 待办」里</p>
      </Section>

      <Section title="逐日" aside={<span className="aside">{nAlts} 个备选 · 点一天看细节、换备选</span>}>
        {picked.size > 0 && (
          <p className="picked-note">
            <span>已换成备选：{[...picked].map((k) => `D${k.split('.')[0]}`).filter((x, i, a) => a.indexOf(x) === i).join('、')}</span>
            <button className="link" onClick={onReset}>全部恢复原计划</button>
          </p>
        )}
        <div className="alt-legend" aria-label="备选图例">
          {kinds.map((k) => <span key={k}><AltMark kind={k} />{ALT_META[k].label}</span>)}
          <span><i className="tl-has-alt" aria-hidden />这天有备选</span>
        </div>
        <Timeline plan={plan} eff={eff} day={day} onDay={onDay} onHoverDay={onHoverDay} />
      </Section>

      <Section title="随机应变">
        <div className="rules">
          {plan.rules.map((g) => (
            <details key={g.title} className="rule" open={g.kind === 'blizzard'}>
              <summary>{g.title}<small>{g.items.length} 条</small></summary>
              <ul className="notes">
                {g.items.map((it, k) => (
                  <li key={k} className="note note-info">
                    <span className="tone tone-info" aria-hidden>·</span>
                    <div><p>{it.text}</p><div className="note-meta"><Refs refs={it.refs} links={it.links} onTrip={onTrip} /></div></div>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </Section>
    </div>
  )
}

/** 今天的情况：每个有备选的位置一行单选，「原计划」和各个备选并排；选中的实心，可选的空心 */
function AltPicker({ d, eff, onPick, onPreview }: {
  d: SgDay
  eff: EffDay
  onPick: (spot: string, key: string | null) => void
  onPreview: (key: string | null) => void
}) {
  const rows: { spot: string; label: string; alts: { key: string; alt: SgAlt }[]; cur: string | null; locked: boolean }[] = []
  if (d.alts?.length) rows.push({ spot: `${d.day}.d`, label: '全天', alts: d.alts.map((alt, k) => ({ key: altKey(d.day, 'd', k), alt })), cur: eff.dayAltKey, locked: false })
  d.slots.forEach((s, i) => {
    if (!s.alts?.length) return
    const e = eff.slots[i]
    rows.push({
      spot: `${d.day}.${i}`, label: `${SLOT_LABEL[s.slot]} · ${s.short}`,
      alts: s.alts.map((alt, k) => ({ key: altKey(d.day, i, k), alt })),
      cur: e.altKey && altSpot(e.altKey) === `${d.day}.${i}` ? e.altKey : null,
      locked: !!eff.dayAlt,
    })
  })
  if (!rows.length) return null
  return (
    <section className="picker" aria-label="今天的情况">
      <header><h3>今天的情况</h3><small>选了备选，下面的安排和地图都会跟着换</small></header>
      {rows.map((r) => (
        <div key={r.spot} className={`picker-row ${r.locked ? 'locked' : ''}`} role="radiogroup" aria-label={r.label}>
          <span className="picker-label">{r.label}</span>
          <span className="picker-opts">
            <button role="radio" aria-checked={!r.cur} className={`opt opt-main ${!r.cur ? 'on' : ''}`} disabled={r.locked} onClick={() => onPick(r.spot, null)}>
              <i aria-hidden />原计划
            </button>
            {r.alts.map(({ key, alt }) => (
              <button key={key} role="radio" aria-checked={r.cur === key} className={`opt ${r.cur === key ? 'on' : ''}`} disabled={r.locked}
                title={`如果${alt.if}`}
                onClick={() => onPick(r.spot, r.cur === key ? null : key)}
                onMouseEnter={() => onPreview(key)} onMouseLeave={() => onPreview(null)} onFocus={() => onPreview(key)} onBlur={() => onPreview(null)}>
                <i aria-hidden /><AltMark kind={alt.kind} />{alt.short}
              </button>
            ))}
          </span>
          {r.locked && <small className="picker-lock">已整天换成备选</small>}
        </div>
      ))}
    </section>
  )
}

/** 这天的住处：悬停在地图上标出来，按钮跳谷歌地图 */
function StayLine({ id, booking, label, onHover, onPlace }: { id: string; booking?: SgBooking; label: string; onHover: (id: string | null) => void; onPlace: (id: string) => void }) {
  const p = placeById.get(id)
  if (!p) return null
  return (
    <div className="logi-row" onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)}>
      <span className="logi-k">{label}</span>
      <span className="logi-v">
        {p.offmap ? <b>{p.name}</b> : <button className="logi-name" onClick={() => onPlace(id)}>{p.name}</button>}
        {booking && <small className={`logi-st st-${booking.status}`}>{booking.status === 'booked' ? '已订' : '在订'}</small>}
      </span>
      <GMap href={gmapPlace(id)} label={`在谷歌地图里看 ${p.name}`} />
    </div>
  )
}

/** 这天的主要交通：悬停在地图上高亮这一段，按钮跳谷歌地图查路线 */
function RideLine({ r, k, day, onHover }: { r: SgRide; k: number; day: number; onHover: (key: string | null) => void }) {
  const a = placeById.get(r.from), b = placeById.get(r.to)
  return (
    <li className="ride" onMouseEnter={() => onHover(`${day}.${k}`)} onMouseLeave={() => onHover(null)}>
      <span className={`mode mode-${r.mode}`}>{MODE_LABEL[r.mode]}</span>
      <span className="ride-body">
        <b>{a?.name ?? r.from} → {b?.name ?? r.to}</b>
        {r.time && <small className="ride-time">{r.time}</small>}
        <small>{r.what}</small>
      </span>
      <GMap href={gmapRide(r)} label={`在谷歌地图里查 ${a?.name} 到 ${b?.name}`} />
    </li>
  )
}

/** 某一天：今天的情况（选备选）、住和行、三个时段（按选择显示）、当晚住处 */
export function PlanDayDetail({ plan, d, picked, onBack, onDay, onPick, onPreview, onHoverPlace, onHoverRide, onTrip, onPlace }: {
  plan: SgPlan
  d: SgDay
  picked: Set<string>
  onBack: () => void
  onDay: (d: number) => void
  onPick: (spot: string, key: string | null) => void
  onPreview: (key: string | null) => void
  onHoverPlace: (id: string | null) => void
  onHoverRide: (key: string | null) => void
  onTrip: (id: string) => void
  onPlace: (id: string) => void
}) {
  const first = plan.days[0].day, last = plan.days[plan.days.length - 1].day
  const eff = useMemo(() => effDay(d, picked), [d, picked])
  const prev = plan.days.find((x) => x.day === d.day - 1)
  // 连住的第二晚没写 booking，沿用第一晚的
  const bookingOf = (day?: SgDay) => {
    if (!day?.stay) return undefined
    let i = plan.days.indexOf(day)
    while (i > 0 && !plan.days[i].stayBooking && plan.days[i - 1].stay === day.stay) i--
    return plan.days[i].stayBooking
  }
  const stay = d.stay ? placeById.get(d.stay) : null
  const from = prev?.stay && prev.stay !== d.stay ? prev.stay : null

  return (
    <div className="detail plan">
      <div className="detail-top">
        <button className="back" onClick={onBack}>← 全程</button>
        <span className="day-nav">
          <button disabled={d.day <= first} onClick={() => onDay(d.day - 1)} aria-label="前一天">‹</button>
          <span>D{d.day} / {last}</span>
          <button disabled={d.day >= last} onClick={() => onDay(d.day + 1)} aria-label="后一天">›</button>
        </span>
      </div>
      <header className="detail-h">
        <div className="kicker">第 {d.day} 天{d.date ? ` · ${fmtDay(d.date)}` : ''}{d.stay ? ` · 住${d.short}` : ''}</div>
        <h2>{d.title}</h2>
      </header>

      <AltPicker d={d} eff={eff} onPick={onPick} onPreview={onPreview} />

      <section className="logi" aria-label="住和行">
        {from && <StayLine id={from} label="出发" onHover={onHoverPlace} onPlace={onPlace} />}
        {d.stay && <StayLine id={d.stay} label="今晚" booking={bookingOf(d)} onHover={onHoverPlace} onPlace={onPlace} />}
        {d.rides && d.rides.length > 0 && (
          <ol className="rides" aria-label="当天主要交通">
            {d.rides.map((r, k) => <RideLine key={k} r={r} k={k} day={d.day} onHover={onHoverRide} />)}
          </ol>
        )}
      </section>

      {d.move && (
        <div className="sg-move">
          <div className="leg-h">
            <ModeTags modes={d.move.mode} />
            <span className="leg-dir">{areaName(d.move.between[0])} → {areaName(d.move.between[1])}</span>
            {d.move.time && <span>⏱ {d.move.time}</span>}
          </div>
          <p className="leg-how">{d.move.how}</p>
          <Booking b={d.move.booking} />
          <Refs refs={d.move.refs} links={d.move.links} onTrip={onTrip} />
        </div>
      )}

      {eff.dayAlt && (
        <div className="swap-day">
          <p className="swap-h"><AltMark kind={eff.dayAlt.kind} /><b>整天换成：{eff.dayAlt.title}</b><button className="link" onClick={() => onPick(`${d.day}.d`, null)}>恢复原计划</button></p>
          <p className="swap-if">如果{eff.dayAlt.if}</p>
          {eff.dayAlt.stops.length > 0 && <Stops ids={eff.dayAlt.stops} onPlace={onPlace} />}
          <p className="sg-text">{eff.dayAlt.text}</p>
          <Refs refs={eff.dayAlt.refs} links={eff.dayAlt.links} onTrip={onTrip} />
        </div>
      )}

      <ol className={`sg-slots ${eff.dayAlt ? 'day-swapped' : ''}`}>
        {eff.slots.map(({ i, slot: s, alt, altKey: ak }) => {
          // 整天换掉时，原来的时段只留一行标题，供对照
          if (eff.dayAlt) {
            return (
              <li key={i} className="sg-slot was">
                <div className="sg-when"><b>{SLOT_LABEL[s.slot]}</b>{s.time && <small>{s.time}</small>}</div>
                <p className="sg-was">原计划：{s.title}</p>
              </li>
            )
          }
          if (alt && ak) {
            return (
              <li key={i} className="sg-slot swapped">
                <div className="sg-when"><b>{SLOT_LABEL[s.slot]}</b>{s.time && <small>{s.time}</small>}</div>
                <div className="sg-body">
                  <p className="sg-tag"><AltMark kind={alt.kind} />备选 · {ALT_META[alt.kind].label}</p>
                  <p className="sg-title">{alt.title}</p>
                  <p className="swap-if">如果{alt.if}</p>
                  {alt.stops.length > 0 && <Stops ids={alt.stops} onPlace={onPlace} />}
                  <p className="sg-text">{alt.text}</p>
                  <Refs refs={alt.refs} links={alt.links} onTrip={onTrip} />
                  <p className="sg-was">原计划：{s.title}<button className="link" onClick={() => onPick(altSpot(ak), null)}>↺ 恢复</button></p>
                </div>
              </li>
            )
          }
          return (
            <li key={i} className="sg-slot">
              <div className="sg-when"><b>{SLOT_LABEL[s.slot]}</b>{s.time && <small>{s.time}</small>}</div>
              <div className="sg-body">
                <p className="sg-title">{s.title}</p>
                <Stops ids={s.stops} onPlace={onPlace} />
                {s.via && <p className="sg-via">🚃 {s.via}</p>}
                <p className="sg-text">{s.text}</p>
                <Booking b={s.booking} />
                <Refs refs={s.refs} links={s.links} onTrip={onTrip} />
              </div>
            </li>
          )
        })}
      </ol>

      {stay && (
        <Section title="住">
          <p className="sg-stay">{stay.name}</p>
          <Booking b={bookingOf(d)} />
          {d.stayNote && <p className="sg-text">{d.stayNote}</p>}
          <Refs refs={d.stayRefs} links={d.stayLinks} onTrip={onTrip} />
        </Section>
      )}
    </div>
  )
}
