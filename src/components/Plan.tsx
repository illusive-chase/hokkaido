import { useMemo } from 'react'
import { placeById } from '../data'
import { ALT_META, altKey, refTrip, SLOT_LABEL } from '../plan'
import { areaName } from '../transit'
import type { AltKind, SgAlt, SgDay, SgLink, SgPlan } from '../types'
import { Section } from './bits'
import { ModeTags } from './Transit'

/** 出处：帖子作者，点开看原帖；官网等外部出处在新窗口打开，标出查阅日期 */
function Refs({ refs, links, onTrip }: { refs?: string[]; links?: SgLink[]; onTrip: (id: string) => void }) {
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

function AltMark({ kind }: { kind: AltKind }) {
  const m = ALT_META[kind]
  return <span className={`alt-mark alt-${kind}`} aria-label={m.label} title={m.label}>{m.icon}</span>
}

const Stops = ({ ids, onPlace }: { ids: string[]; onPlace: (id: string) => void }) => (
  <div className="stops">
    {ids.map((id, k) => {
      const p = placeById.get(id)
      return p ? <button key={k} className={`stop stop-${p.kind}`} onClick={() => onPlace(id)}>{p.name}</button> : null
    })}
  </div>
)

function AltCard({ alt, k, on, onPick, onHover, onTrip, onPlace }: {
  alt: SgAlt
  k: string
  on: boolean
  onPick: (key: string | null) => void
  onHover: (key: string | null) => void
  onTrip: (id: string) => void
  onPlace: (id: string) => void
}) {
  return (
    <div className={`alt-card ${on ? 'on' : ''}`} onMouseEnter={() => onHover(k)} onMouseLeave={() => onHover(null)}>
      <div className="alt-if">
        <AltMark kind={alt.kind} />
        <span>如果{alt.if}</span>
        <button className={`alt-pick ${on ? 'on' : ''}`} onClick={() => onPick(on ? null : k)} aria-pressed={on}>
          {on ? '已换成这个 ✓' : '换成这个'}
        </button>
      </div>
      <p className="alt-title">{alt.title}</p>
      {alt.stops.length > 0 && <Stops ids={alt.stops} onPlace={onPlace} />}
      <p className="alt-text">{alt.text}</p>
      <Refs refs={alt.refs} links={alt.links} onTrip={onTrip} />
    </div>
  )
}

/**
 * 全程时间轴：一行一天，三列是上午、下午、傍晚。
 * 跨城那天在行首标出交通；有分支的格子右上角挂一个天气图标，整天的分支挂在行尾。
 * 选中的分支会替换掉对应格子的内容，并用分支色描边。
 */
function Timeline({ plan, day, alt, onDay, onHoverDay }: {
  plan: SgPlan
  day: number | null
  alt: string | null
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
        const dayAlt = (d.alts ?? []).findIndex((_, k) => altKey(d.day, 'd', k) === alt)
        return (
          <li key={d.day} className={`tl-row ${day === d.day ? 'on' : ''} ${dayAlt >= 0 ? 'swapped' : ''}`}>
            <button className="tl-btn" onClick={() => onDay(d.day)} onMouseEnter={() => onHoverDay(d.day)} onMouseLeave={() => onHoverDay(null)}
              aria-label={`第 ${d.day} 天：${d.title}`}>
              <span className="tl-day">
                <b>D{d.day}</b>
                {d.move && <small><ModeTags modes={d.move.mode.slice(0, 1)} /></small>}
              </span>
              {(['am', 'pm', 'eve'] as const).map((sl) => {
                const items = d.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.slot === sl)
                if (!items.length) return <span key={sl} className="tl-cell empty" />
                return (
                  <span key={sl} className="tl-cell">
                    {items.map(({ s, i }) => {
                      const ak = (s.alts ?? []).findIndex((_, k) => altKey(d.day, i, k) === alt)
                      const swapped = ak >= 0 ? s.alts![ak] : dayAlt >= 0 ? d.alts![dayAlt] : null
                      return (
                        <span key={i} className={`tl-item ${swapped ? 'swapped' : ''}`}>
                          {swapped ? <><AltMark kind={swapped.kind} />{swapped.short}</> : s.short}
                          {!swapped && s.alts?.map((a, k) => <AltMark key={k} kind={a.kind} />)}
                        </span>
                      )
                    })}
                  </span>
                )
              })}
              <span className="tl-stay">
                {d.stay ? d.short : '—'}
                {d.alts?.map((a, k) => <AltMark key={k} kind={a.kind} />)}
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
  const runs: { area: string; from: number; n: number }[] = []
  for (const d of plan.days) {
    if (!d.stay) continue
    const area = placeById.get(d.stay)?.area ?? d.stay
    const last = runs[runs.length - 1]
    if (last && last.area === area) last.n++
    else runs.push({ area, from: d.day, n: 1 })
  }
  const total = runs.reduce((s, r) => s + r.n, 0)
  return (
    <div className="staybar" role="list" aria-label="住宿">
      {runs.map((r) => (
        <span key={r.from} role="listitem" style={{ flexGrow: r.n }} className={day != null && day >= r.from && day < r.from + r.n ? 'on' : ''}>
          <b>{areaName(r.area)}</b><small>{r.n} 晚</small>
        </span>
      ))}
      <span className="staybar-n" aria-hidden>{total} 晚</span>
    </div>
  )
}

const ALT_ORDER: AltKind[] = ['snow', 'cloud', 'nosnow', 'sunny', 'makeup']

/** 建议路线的总览：偏好、住宿条、逐日时间轴、应变规则 */
export function PlanOverview({ plan, day, alt, onDay, onHoverDay, onTrip }: {
  plan: SgPlan
  day: number | null
  alt: string | null
  onDay: (d: number) => void
  onHoverDay: (d: number | null) => void
  onTrip: (id: string) => void
}) {
  const kinds = useMemo(() => {
    const s = new Set<AltKind>()
    for (const d of plan.days) {
      for (const a of d.alts ?? []) s.add(a.kind)
      for (const sl of d.slots) for (const a of sl.alts ?? []) s.add(a.kind)
    }
    return ALT_ORDER.filter((k) => s.has(k))
  }, [plan])
  const nAlts = plan.days.reduce((n, d) => n + (d.alts?.length ?? 0) + d.slots.reduce((m, s) => m + (s.alts?.length ?? 0), 0), 0)

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

      <Section title="住宿">
        <StayBar plan={plan} day={day} />
      </Section>

      <Section title="逐日" aside={<span className="aside">{nAlts} 个备选分支 · 点一天看细节</span>}>
        <div className="alt-legend" aria-label="分支图例">
          {kinds.map((k) => <span key={k}><AltMark kind={k} />{ALT_META[k].label}</span>)}
        </div>
        <Timeline plan={plan} day={day} alt={alt} onDay={onDay} onHoverDay={onHoverDay} />
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

/** 某一天：跨城交通、三个时段（主线 + 这一格的分支）、整天的分支、当晚住处 */
export function PlanDayDetail({ plan, d, alt, onBack, onDay, onAlt, onHoverAlt, onTrip, onPlace }: {
  plan: SgPlan
  d: SgDay
  alt: string | null
  onBack: () => void
  onDay: (d: number) => void
  onAlt: (key: string | null) => void
  onHoverAlt: (key: string | null) => void
  onTrip: (id: string) => void
  onPlace: (id: string) => void
}) {
  const first = plan.days[0].day, last = plan.days[plan.days.length - 1].day
  const stay = d.stay ? placeById.get(d.stay) : null
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
        <div className="kicker">第 {d.day} 天{d.stay ? ` · 住${d.short}` : ''}</div>
        <h2>{d.title}</h2>
      </header>

      {d.move && (
        <div className="sg-move">
          <div className="leg-h">
            <ModeTags modes={d.move.mode} />
            <span className="leg-dir">{areaName(d.move.between[0])} → {areaName(d.move.between[1])}</span>
            {d.move.time && <span>⏱ {d.move.time}</span>}
          </div>
          <p className="leg-how">{d.move.how}</p>
          <Refs refs={d.move.refs} links={d.move.links} onTrip={onTrip} />
        </div>
      )}

      <ol className="sg-slots">
        {d.slots.map((s, i) => {
          const picked = (s.alts ?? []).findIndex((_, k) => altKey(d.day, i, k) === alt)
          return (
            <li key={i} className={`sg-slot ${picked >= 0 ? 'replaced' : ''}`}>
              <div className="sg-when"><b>{SLOT_LABEL[s.slot]}</b>{s.time && <small>{s.time}</small>}</div>
              <div className="sg-body">
                <p className="sg-title">{s.title}</p>
                <Stops ids={s.stops} onPlace={onPlace} />
                {s.via && <p className="sg-via">🚃 {s.via}</p>}
                <p className="sg-text">{s.text}</p>
                <Refs refs={s.refs} links={s.links} onTrip={onTrip} />
                {s.alts?.map((a, k) => (
                  <AltCard key={k} alt={a} k={altKey(d.day, i, k)} on={k === picked} onPick={onAlt} onHover={onHoverAlt} onTrip={onTrip} onPlace={onPlace} />
                ))}
              </div>
            </li>
          )
        })}
      </ol>

      {d.alts && d.alts.length > 0 && (
        <Section title="整天的备选">
          {d.alts.map((a, k) => (
            <AltCard key={k} alt={a} k={altKey(d.day, 'd', k)} on={alt === altKey(d.day, 'd', k)} onPick={onAlt} onHover={onHoverAlt} onTrip={onTrip} onPlace={onPlace} />
          ))}
        </Section>
      )}

      {stay && (
        <Section title="住">
          <p className="sg-stay"><button className="link" onClick={() => onPlace(stay.id)}>{stay.name}</button></p>
          {d.stayNote && <p className="sg-text">{d.stayNote}</p>}
          <Refs refs={d.stayRefs} onTrip={onTrip} />
        </Section>
      )}
    </div>
  )
}
