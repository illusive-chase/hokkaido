import { useEffect, useMemo, useState } from 'react'
import { areaById, fmtCount, fmtDate, KIND_LABEL, placeById, textUrl } from '../data'
import type { Trip } from '../types'
import { Img, Lightbox, NoteLine, Section } from './bits'

interface RawText {
  desc: string
  commentTotal: number | null
  comments: { user: string; isAuthor: boolean; pinned?: boolean; content: string; ip: string; likes: number; replyTotal?: number; replies: { user: string; isAuthor: boolean; content: string }[] }[]
  /** 旧版 public/local/text 里没有这个字段，当作未采集 */
  commentSource?: { full: boolean; complete?: boolean; at?: string }
}

function commentHeading(raw: RawText) {
  const got = raw.comments.reduce((s, c) => s + 1 + c.replies.length, 0)
  const total = raw.commentTotal ?? '?'
  if (!raw.commentSource?.full) return `评论（未登录只能拿到前几条，${got} / ${total} 条）`
  return `评论（插件采集${raw.commentSource.complete ? '，已翻完' : '，未翻完'}，${got} / ${total} 条）`
}

export default function TripDetail({ t, onBack, onPlace, onHoverPlace, onCompare, compareSlot, compareFull, onTransit }: {
  t: Trip
  onBack: () => void
  onPlace: (id: string) => void
  onHoverPlace: (id: string | null) => void
  onCompare: () => void
  compareSlot: number
  compareFull: boolean
  /** 切到城际图层看这篇怎么在城市之间移动 */
  onTransit?: () => void
}) {
  const [lb, setLb] = useState<number | null>(null)
  const [raw, setRaw] = useState<RawText | null | 'none'>(null)
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    setRaw(null)
    setShowRaw(false)
    fetch(textUrl(t.id)).then((r) => (r.ok ? r.json() : 'none')).then(setRaw).catch(() => setRaw('none'))
  }, [t.id])

  const imgs = useMemo(() => t.src.images.map((_, k) => ({ trip: t.id, i: k + 1 })), [t])
  const groupedTips = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const tip of t.tips ?? []) m.set(tip.topic, [...(m.get(tip.topic) ?? []), tip.text + (tip.from === 'comment' ? '' : '')])
    return [...m]
  }, [t])
  const notesByPlace = useMemo(() => {
    const order = [...t.route, ...(t.notes ?? []).map((n) => n.place)]
    return [...(t.notes ?? [])].sort((a, b) => order.indexOf(a.place) - order.indexOf(b.place))
  }, [t])

  const PlaceBtn = ({ id }: { id: string }) => {
    const p = placeById.get(id)
    if (!p) return null
    return (
      <button
        className={`stop stop-${p.kind}`}
        onClick={() => onPlace(id)}
        onMouseEnter={() => onHoverPlace(id)}
        onMouseLeave={() => onHoverPlace(null)}
      >{p.name}</button>
    )
  }

  return (
    <div className="detail">
      <div className="detail-top">
        <button className="back" onClick={onBack}>← 全部帖子</button>
        {t.route.length > 1 && (
          <button
            className={`cmp-btn ${compareSlot >= 0 ? `on slot-${compareSlot}` : ''}`}
            onClick={onCompare}
            disabled={compareSlot < 0 && compareFull}
          >{compareSlot >= 0 ? `对比 ${'ABC'[compareSlot]} ✓` : '＋加入对比'}</button>
        )}
      </div>

      <div className="hero-strip" role="list">
        {imgs.map((it, k) => (
          <button key={k} className="hero-img" role="listitem" onClick={() => setLb(k)} aria-label={`第 ${k + 1} 张图`}>
            <Img trip={t.id} i={it.i} thumb />
            {t.photoPlace.has(it.i) && <span className="hero-tag">{placeById.get(t.photoPlace.get(it.i)!)?.name}</span>}
          </button>
        ))}
      </div>

      <header className="detail-h">
        <div className="kicker">
          {KIND_LABEL[t.kind]}{t.days ? ` · ${t.days} 天` : ''}{t.when ? ` · ${t.when}` : ''}
          {t.commercial && <span className="badge">推广</span>}
        </div>
        <h2>{t.src.title}</h2>
        <p className="lede">{t.summary}</p>
        <div className="byline">
          <span>{t.src.author}</span>
          <span>{fmtDate(t.src.publishTime)}</span>
          <span>赞 {fmtCount(t.src.counts.liked)}</span>
          <span>藏 {fmtCount(t.src.counts.collected)}</span>
          <a href={t.src.url} target="_blank" rel="noreferrer">小红书原帖 ↗</a>
        </div>
        {onTransit && <button className="link small transit-link" onClick={onTransit}>在城际通行图层看这篇的城际交通 →</button>}
        {(t.style?.length || t.budget || t.in || t.out) && (
          <dl className="facts">
            {t.bases.length > 0 && <><dt>住</dt><dd>{t.bases.map((b) => areaById.get(b)?.name).join(' → ')}</dd></>}
            {(t.in || t.out) && <><dt>进出</dt><dd>{placeById.get(t.in ?? '')?.name ?? '—'} 进 · {placeById.get(t.out ?? '')?.name ?? '—'} 出</dd></>}
            {t.budget && <><dt>花费</dt><dd>{t.budget}</dd></>}
            {t.style?.length ? <><dt>关键词</dt><dd>{t.style.join(' · ')}</dd></> : null}
          </dl>
        )}
      </header>

      {t.plan && t.plan.length > 0 && (
        <Section title="行程" aside={t.partial ? <span className="aside">{t.partial}</span> : undefined}>
          <ol className="days">
            {t.plan.map((d, k) => (
              <li key={k} className="day">
                <div className="day-n">{d.label ?? `D${d.day}`}</div>
                <div className="day-b">
                  <p className="day-t">{d.title}</p>
                  <div className="stops">
                    {d.stops.filter((s, j) => d.stops.indexOf(s) === j).map((s) => <PlaceBtn key={s} id={s} />)}
                  </div>
                  {(d.stay || d.move) && (
                    <div className="day-foot">
                      {d.stay && <span>宿 · <button className="link" onClick={() => onPlace(d.stay!)}>{placeById.get(d.stay)?.name}</button></span>}
                      {d.move && <span>{d.move}</span>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {t.ratings && t.ratings.length > 0 && (
        <Section title="评分">
          <ul className="ratings">
            {t.ratings.map((r) => (
              <li key={r.place}>
                <button className="link" onClick={() => onPlace(r.place)}>{placeById.get(r.place)?.name}</button>
                <span className="bar" aria-hidden><i style={{ width: `${(r.score / 5) * 100}%` }} /></span>
                <span className="rlabel">{r.label}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {notesByPlace.length > 0 && (
        <Section title="地点经验" aside={<span className="aside">{notesByPlace.length} 条</span>}>
          <ul className="notes">
            {notesByPlace.map((n, k) => <NoteLine key={k} note={n} place onPlace={onPlace} />)}
          </ul>
        </Section>
      )}

      {groupedTips.length > 0 && (
        <Section title="通用建议">
          <dl className="tips">
            {groupedTips.map(([topic, list]) => (
              <div key={topic}>
                <dt>{topic}</dt>
                {list.map((x, k) => <dd key={k}>{x}</dd>)}
              </div>
            ))}
          </dl>
        </Section>
      )}

      <Section title="原文与评论" aside={raw && raw !== 'none' ? <button className="link" onClick={() => setShowRaw(!showRaw)}>{showRaw ? '收起' : '展开'}</button> : undefined}>
        {raw === 'none' && <p className="muted small">本地没有原文。运行 <code>npm run data</code> 从 data/notes 生成。</p>}
        {raw && raw !== 'none' && showRaw && (
          <div className="raw">
            <pre>{raw.desc}</pre>
            <h4>{commentHeading(raw)}</h4>
            <ul>
              {raw.comments.map((c, k) => (
                <li key={k}>
                  <p><b className={c.isAuthor ? 'is-author' : ''}>{c.user}{c.isAuthor ? '（作者）' : ''}{c.pinned ? '（置顶）' : ''}</b>{c.content}</p>
                  {c.replies.map((r, j) => (
                    <p key={j} className="reply"><b className={r.isAuthor ? 'is-author' : ''}>{r.user}{r.isAuthor ? '（作者）' : ''}</b>{r.content}</p>
                  ))}
                  {(c.replyTotal ?? 0) > c.replies.length && <p className="reply muted">还有 {(c.replyTotal ?? 0) - c.replies.length} 条回复没拿到</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {raw && raw !== 'none' && !showRaw && <p className="muted small">正文 {raw.desc.length} 字 · 评论 {raw.comments.reduce((s, c) => s + 1 + c.replies.length, 0)} 条{raw.commentSource?.full ? '（插件采集）' : ''}</p>}
      </Section>

      {lb !== null && (
        <Lightbox
          items={imgs}
          start={lb}
          onClose={() => setLb(null)}
          caption={(it) => placeById.get(t.photoPlace.get(it.i) ?? '')?.name ?? t.src.title}
        />
      )}
    </div>
  )
}
