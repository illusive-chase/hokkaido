import { useCallback, useEffect, useMemo, useState } from 'react'
import MapView, { type Focus, type Layer } from './map/MapView'
import type { RouteSpec } from './map/geo'
import { areaById, areas, ELEM_LABEL, ELEMS, placeAgg, placeById, tripById, trips, type Elem } from './data'
import { filterPlaces, filterTransit, filterTrips, type PlaceFilter, type TransitFilter, type TripFilter } from './filters'
import { allEdges, areaAnchor, buildEdges, tripTransit } from './transit'
import { PALETTES, useTheme } from './theme'
import { TripCard, TripFilters } from './components/TripList'
import TripDetail from './components/TripDetail'
import { PlaceDetail, PlaceFilters, PlaceList } from './components/PlacePanels'
import { CityDetail, EdgeDetail, EdgeList, TransitCard, TransitFilters, TransitTrip } from './components/Transit'
import Compare from './components/Compare'
import { PlanDayDetail, PlanOverview } from './components/Plan'
import { altsOf, dayPoints, mainStops, plans } from './plan'
import { Chip } from './components/bits'
import type { Place } from './types'

type Tab = 'trips' | 'places'
type TTab = 'trips' | 'edges'
type View = { layer: Layer; tab: Tab; ttab: TTab; trip: string | null; place: string | null; edge: string | null; city: string | null; day: number | null; alt: string | null }

const regionOf = (p: Place) => areaById.get(p.area)?.region ?? null
const areaNames = new Map(areas.map((a) => [a.id, a.name]))
const LAYER_LABEL: Record<Layer, string> = { plan: '建议路线', transit: '城际通行', city: '城市内' }
const LAYERS: Layer[] = ['plan', 'transit', 'city']
/** 目前只有一份建议路线 */
const plan = plans[0] ?? null
const planAltKeys = new Set(plan ? altsOf(plan).map((r) => r.key) : [])

/** 视图状态写进 URL hash，方便分享和前进后退 */
function readHash(): View {
  const h = new URLSearchParams(location.hash.slice(1))
  const trip = h.get('trip')
  const place = h.get('place')
  const edge = h.get('edge')
  const city = h.get('city')
  // 没写图层时默认打开建议路线；旧链接（#trip=…、#place=… 之类）仍然落在城市内图层
  const lp = h.get('layer')
  const cityKeys = ['trip', 'place', 'cmp', 'tab'].some((k) => h.has(k))
  const layer: Layer = lp === 'transit' || lp === 'city' || lp === 'plan' ? lp : plan && !cityKeys ? 'plan' : 'city'
  const day = Number(h.get('day'))
  const alt = h.get('alt')
  return {
    layer,
    tab: h.get('tab') === 'places' ? 'places' : 'trips',
    ttab: h.get('ttab') === 'edges' ? 'edges' : 'trips',
    trip: trip && tripById.has(trip) ? trip : null,
    place: layer === 'city' && place && placeById.has(place) ? place : null,
    edge: layer === 'transit' && edge && allEdges.has(edge) ? edge : null,
    city: layer === 'transit' && city && areaAnchor.has(city) ? city : null,
    day: layer === 'plan' && plan?.days.some((d) => d.day === day) ? day : null,
    alt: layer === 'plan' && alt && planAltKeys.has(alt) ? alt : null,
  }
}
function writeHash(v: View, cmp: string[]) {
  const h = new URLSearchParams()
  if (v.layer !== 'plan' || !plan) h.set('layer', v.layer)
  if (v.layer === 'plan' && v.day != null) h.set('day', String(v.day))
  if (v.layer === 'plan' && v.alt) h.set('alt', v.alt)
  if (v.layer === 'city' && v.tab !== 'trips') h.set('tab', v.tab)
  if (v.layer === 'transit' && v.ttab !== 'trips') h.set('ttab', v.ttab)
  if (v.trip) h.set('trip', v.trip)
  if (v.place) h.set('place', v.place)
  if (v.edge) h.set('edge', v.edge)
  if (v.city) h.set('city', v.city)
  if (cmp.length) h.set('cmp', cmp.join(','))
  const s = h.toString()
  if (s !== location.hash.slice(1)) history.pushState(null, '', s ? `#${s}` : location.pathname)
}
const readCmp = () => (new URLSearchParams(location.hash.slice(1)).get('cmp') ?? '').split(',').filter((id) => tripById.has(id)).slice(0, 3)

export default function App() {
  const { theme, toggle } = useTheme()
  const palette = PALETTES[theme]
  const [view, setView] = useState<View>(readHash)
  const [cmp, setCmp] = useState<string[]>(readCmp)
  const [cmpOpen, setCmpOpen] = useState(() => readCmp().length > 1)
  const [tf, setTf] = useState<TripFilter>({ kinds: new Set(), regions: new Set(), days: 'any', q: '', sort: 'collected' })
  const [pf, setPf] = useState<PlaceFilter>({ theme: null, regions: new Set(), q: '' })
  const [xf, setXf] = useState<TransitFilter>({ q: '', modes: new Set(), regions: new Set() })
  const [elems, setElems] = useState<Set<Elem>>(() => new Set<Elem>(['sight', 'transport']))
  const [hoverTrip, setHoverTrip] = useState<string | null>(null)
  const [hoverPlace, setHoverPlace] = useState<string | null>(null)
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const [hoverAlt, setHoverAlt] = useState<string | null>(null)
  const [narrow, setNarrow] = useState(() => window.innerWidth < 860)
  const [sheet, setSheet] = useState(true)
  // 从地图上点开的详情不移动地图；从面板里点开的才把它带进视野
  const [pickedOnMap, setPickedOnMap] = useState(false)

  useEffect(() => {
    const on = () => { setView(readHash()); setCmp(readCmp()); setPickedOnMap(false) }
    window.addEventListener('popstate', on)
    const rs = () => setNarrow(window.innerWidth < 860)
    window.addEventListener('resize', rs)
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('resize', rs) }
  }, [])

  const go = useCallback((v: Partial<View>, fromMap = false) => {
    setView((cur) => {
      const next = { ...cur, ...v }
      writeHash(next, cmp)
      return next
    })
    setPickedOnMap(fromMap)
    setSheet(true)
  }, [cmp])

  const switchLayer = (layer: Layer) => {
    if (layer === view.layer) return
    setHoverEdge(null); setHoverPlace(null); setHoverTrip(null); setHoverDay(null); setHoverAlt(null)
    go({ layer, place: null, edge: null, city: null })
  }

  const toggleCmp = (id: string) => {
    setCmp((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 3 ? cur : [...cur, id]
      writeHash(view, next)
      if (next.length >= 2 && !cur.includes(id)) setCmpOpen(true)
      if (next.length < 1) setCmpOpen(false)
      return next
    })
  }

  const isCity = view.layer === 'city'
  const filtered = useMemo(() => filterTrips(tf), [tf])
  const inScope = useMemo(() => new Set(filtered.map((t) => t.id)), [filtered])
  const placeRows = useMemo(() => filterPlaces(pf, elems, filtered, regionOf), [pf, elems, filtered])
  const transitList = useMemo(() => filterTransit(xf), [xf])
  const edgeMap = useMemo(() => buildEdges(transitList, xf.modes), [transitList, xf.modes])
  const edgeList = useMemo(() => [...edgeMap.values()].sort((a, b) => b.trips.length - a.trips.length || b.legs.length - a.legs.length), [edgeMap])
  const cmpTrips = cmp.map((id) => tripById.get(id)!).filter(Boolean)
  const openTrip = view.trip ? tripById.get(view.trip)! : null
  const comparing = isCity && cmpOpen && cmpTrips.length > 0
  // 选中的路段在当前筛选里可能没有，回退到全部帖子统计的那一条
  const openEdge = view.edge ? edgeMap.get(view.edge) ?? allEdges.get(view.edge) ?? null : null

  // —— 城市内图层：地图要画什么 ——
  const routeSpecs = useMemo<RouteSpec[]>(() => {
    if (!isCity) return []
    if (comparing) return cmpTrips.map((t, k) => ({ trip: t, color: palette.compare[k], bend: [0.1, -0.12, 0.22][k], width: 2.4 }))
    const t = openTrip ?? (hoverTrip ? tripById.get(hoverTrip)! : null)
    return t ? [{ trip: t, color: palette.accent, bend: 0.14, width: openTrip ? 2.6 : 2 }] : []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCity, comparing, cmp, openTrip, hoverTrip, palette])

  const highlight = useMemo(() => {
    const m = new Map<string, string>()
    if (comparing) {
      cmpTrips.forEach((t, k) => t.route.forEach((p) => { if (!m.has(p)) m.set(p, palette.compare[k]) }))
    } else if (openTrip) {
      openTrip.route.forEach((p) => m.set(p, palette.accent))
    } else if (hoverTrip) {
      tripById.get(hoverTrip)!.route.forEach((p) => m.set(p, palette.accent))
    }
    if (hoverPlace) m.set(hoverPlace, m.get(hoverPlace) ?? palette.accent)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparing, cmp, openTrip, hoverTrip, hoverPlace, palette])

  const activePlaces = useMemo(() => {
    if (view.tab === 'places' && !view.place) return new Set(placeRows.map((r) => r.place.id))
    if (openTrip && !comparing) return openTrip.mentions
    return null
  }, [view, placeRows, openTrip, comparing])

  // —— 城际图层：高亮哪些路段和城市 ——
  const litEdges = useMemo(() => {
    const s = new Set<string>()
    const t = openTrip ?? (hoverTrip ? tripById.get(hoverTrip) : null)
    if (t) tripTransit.get(t.id)!.edges.forEach((k) => s.add(k))
    if (view.city && !t) for (const e of edgeMap.values()) if (e.a === view.city || e.b === view.city) s.add(e.key)
    return s
  }, [openTrip, hoverTrip, view.city, edgeMap])
  const litCities = useMemo(() => {
    const s = new Set<string>()
    for (const k of [...litEdges, view.edge, hoverEdge]) if (k) k.split('~').forEach((a) => s.add(a))
    if (view.city) s.add(view.city)
    return s
  }, [litEdges, view.edge, hoverEdge, view.city])

  // —— 视野 ——
  const focus = useMemo<Focus | null>(() => {
    const at = (ids: Iterable<string>) => [...ids].map((id) => placeById.get(id)).filter((p) => p && !p.offmap).map((p) => p!.at)
    const areasAt = (ids: Iterable<string>) => [...ids].map((a) => areaAnchor.get(a)).filter((x): x is [number, number] => !!x)
    if (view.layer === 'plan') {
      if (!plan) return null
      if (view.day != null) {
        const alt = view.alt ? altsOf(plan).find((r) => r.key === view.alt) ?? null : null
        return { key: `pd:${view.day}`, pts: dayPoints(plan, view.day, alt?.day.day === view.day ? alt : null), mode: 'fit', maxZoom: 12.5 }
      }
      return { key: 'pa', pts: mainStops(plan).map((x) => x.at), mode: 'fit' }
    }
    if (isCity) {
      // 点地图上的单个地点：不缩放；从列表里点开的，只在它不在视野里时平移过去
      if (view.place) return { key: `p:${view.place}`, pts: at([view.place]), mode: 'reveal' }
      if (comparing) return { key: `c:${cmp.join()}`, pts: at(cmpTrips.flatMap((t) => t.route)), mode: 'fit' }
      if (openTrip) return { key: `t:${openTrip.id}`, pts: at(openTrip.route.length ? openTrip.route : openTrip.mentions), mode: 'fit' }
      return null
    }
    if (view.edge) return { key: `e:${view.edge}`, pts: areasAt(view.edge.split('~')), mode: 'reveal' }
    if (view.city) return { key: `a:${view.city}`, pts: areasAt([view.city]), mode: 'reveal' }
    if (openTrip) return { key: `xt:${openTrip.id}`, pts: areasAt(tripTransit.get(openTrip.id)!.chain), mode: 'reveal' }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCity, view.layer, view.day, view.place, view.edge, view.city, comparing, cmp, openTrip])
  const mapFocus = pickedOnMap ? null : focus

  const padding = narrow
    ? { left: 24, right: 24, top: 70, bottom: sheet ? Math.round(window.innerHeight * 0.5) : 90 }
    : { left: 470, right: 40, top: 70, bottom: comparing ? Math.round(window.innerHeight * 0.48) : 40 }

  const pickPlace = (id: string, fromMap = false) => go({ place: id }, fromMap)
  const maxN = placeRows[0]?.n ?? 1

  let panel: React.ReactNode
  const planDay = plan && view.day != null ? plan.days.find((d) => d.day === view.day) ?? null : null
  if (view.layer === 'plan') {
    const toTrip = (id: string) => go({ layer: 'city', trip: id, place: null, day: null, alt: null })
    const toPlace = (id: string) => go({ layer: 'city', place: id, trip: null, day: null, alt: null })
    if (!plan) panel = <p className="empty">atlas/plans 里还没有建议路线。</p>
    else if (planDay) {
      panel = (
        <PlanDayDetail
          key={planDay.day} plan={plan} d={planDay} alt={view.alt}
          onBack={() => go({ day: null })} onDay={(d) => go({ day: d })}
          onAlt={(k) => go({ alt: k })} onHoverAlt={setHoverAlt}
          onTrip={toTrip} onPlace={toPlace}
        />
      )
    } else {
      panel = <PlanOverview plan={plan} day={hoverDay} alt={view.alt} onDay={(d) => go({ day: d })} onHoverDay={setHoverDay} onTrip={toTrip} />
    }
  } else if (isCity) {
    const backLabel = view.trip ? '回到帖子' : view.tab === 'places' ? '全部地点' : '全部帖子'
    if (view.place) {
      panel = <PlaceDetail key={view.place} id={view.place} inScope={inScope} onBack={() => go({ place: null })} onTrip={(id) => go({ trip: id, place: null })} onPlace={pickPlace} backLabel={backLabel} />
    } else if (openTrip) {
      panel = (
        <TripDetail
          key={openTrip.id} t={openTrip}
          onBack={() => go({ trip: null })} onPlace={pickPlace} onHoverPlace={setHoverPlace}
          onCompare={() => toggleCmp(openTrip.id)} compareSlot={cmp.indexOf(openTrip.id)} compareFull={cmp.length >= 3}
          onTransit={tripTransit.get(openTrip.id)!.chain.length > 1 ? () => go({ layer: 'transit', place: null }) : undefined}
        />
      )
    } else if (view.tab === 'trips') {
      panel = (
        <>
          <TripFilters f={tf} set={setTf} count={filtered.length} />
          <div className="cards">
            {filtered.map((t) => (
              <TripCard
                key={t.id} t={t}
                compareSlot={cmp.indexOf(t.id)} compareFull={cmp.length >= 3}
                onOpen={() => go({ trip: t.id })}
                onCompare={() => toggleCmp(t.id)}
                onHover={(on) => setHoverTrip(on ? t.id : null)}
              />
            ))}
            {filtered.length === 0 && <p className="empty">没有符合条件的帖子。</p>}
          </div>
        </>
      )
    } else {
      panel = (
        <>
          <PlaceFilters f={pf} set={setPf} count={placeRows.length} />
          {inScope.size < trips.length && <p className="scope-note">只统计「帖子」页筛选后的 {inScope.size} 篇</p>}
          <PlaceList rows={placeRows} max={maxN} onPick={(id) => pickPlace(id)} onHover={setHoverPlace} />
        </>
      )
    }
  } else {
    const backLabel = view.trip ? '回到帖子' : view.city && view.edge ? '回到城市' : view.ttab === 'edges' ? '全部路段' : '全部帖子'
    const back = () => {
      if (view.edge) go({ edge: null })
      else if (view.city) go({ city: null })
      else go({ trip: null })
    }
    if (openEdge) {
      panel = <EdgeDetail key={openEdge.key} e={openEdge} onBack={back} backLabel={backLabel} onTrip={(id) => go({ trip: id, edge: null, city: null })} onCity={(id) => go({ city: id, edge: null })} />
    } else if (view.city) {
      panel = <CityDetail key={view.city} id={view.city} edges={edgeList} onBack={back} backLabel={view.trip ? '回到帖子' : view.ttab === 'edges' ? '全部路段' : '全部帖子'} onEdge={(k) => go({ edge: k })} onHoverEdge={setHoverEdge} />
    } else if (openTrip) {
      panel = (
        <TransitTrip
          key={openTrip.id} t={openTrip}
          onBack={() => go({ trip: null })} backLabel={view.ttab === 'edges' ? '全部路段' : '全部帖子'}
          onEdge={(k) => go({ edge: k })} onHoverEdge={setHoverEdge}
          onFull={() => go({ layer: 'city' })}
        />
      )
    } else if (view.ttab === 'trips') {
      panel = (
        <>
          <TransitFilters f={xf} set={setXf} count={transitList.length} unit="篇" />
          <div className="cards">
            {transitList.map((t) => <TransitCard key={t.id} t={t} onOpen={() => go({ trip: t.id })} onHover={(on) => setHoverTrip(on ? t.id : null)} />)}
            {transitList.length === 0 && <p className="empty">没有符合条件的帖子。</p>}
          </div>
        </>
      )
    } else {
      panel = (
        <>
          <TransitFilters f={xf} set={setXf} count={edgeList.length} unit="段" />
          <EdgeList edges={edgeList} onPick={(k) => go({ edge: k })} onHover={setHoverEdge} />
        </>
      )
    }
  }

  const showTabs = view.layer === 'plan' ? false : isCity ? !view.trip && !view.place : !view.trip && !view.edge && !view.city

  return (
    <div className={`app ${narrow ? 'narrow' : ''} ${sheet ? 'sheet-open' : 'sheet-closed'} ${comparing ? 'comparing' : ''}`}>
      <MapView
        palette={palette}
        layer={view.layer}
        areaNames={areaNames}
        padding={padding}
        focus={mapFocus}
        overview={!openTrip && !view.place && !comparing}
        trips={filtered}
        routeSpecs={routeSpecs}
        dimCorridors={!!openTrip || comparing}
        elems={elems}
        activePlaces={activePlaces}
        highlight={highlight}
        selectedPlace={view.place}
        onPickPlace={(id) => pickPlace(id, true)}
        onHoverPlace={setHoverPlace}
        edges={edgeList}
        selectedEdge={view.edge}
        hoverEdge={hoverEdge}
        litEdges={litEdges}
        litCities={litCities}
        selectedCity={view.city}
        onPickEdge={(k) => go({ edge: k }, true)}
        onHoverEdge={setHoverEdge}
        onPickCity={(id) => go({ city: id, edge: null }, true)}
        plan={plan}
        planDay={view.day ?? hoverDay}
        planAlt={hoverAlt ?? view.alt}
        onPickAlt={(k) => go({ alt: k, day: Number(k.split('.')[0]) }, true)}
        onHoverAlt={setHoverAlt}
        onPickPlanDay={(d) => go({ day: d }, true)}
      />

      <header className="masthead">
        <div className="brand">
          <h1>雪国手帖</h1>
          <span>北海道 · {trips.length} 篇小红书攻略 · {placeAgg.size} 个地点</span>
        </div>
        <div className="mast-actions">
          {isCity && cmpTrips.length > 0 && !cmpOpen && (
            <button className="pill" onClick={() => setCmpOpen(true)}>
              对比 {cmpTrips.map((_, k) => <i key={k} style={{ background: palette.compare[k] }} />)} {cmpTrips.length}
            </button>
          )}
          <button className="pill icon" onClick={toggle} aria-label={theme === 'dark' ? '切换到雪地主题' : '切换到蓝调主题'} title={theme === 'dark' ? '雪地' : '蓝调时刻'}>
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
                <circle cx="8" cy="8" r="3" />
                <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
                <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <aside className="panel" aria-label="内容面板">
        {narrow && <button className="sheet-handle" onClick={() => setSheet(!sheet)} aria-label={sheet ? '收起面板' : '展开面板'}><i /></button>}
        <div className="layer-switch" role="radiogroup" aria-label="图层">
          {LAYERS.map((l) => (
            <button key={l} role="radio" aria-checked={view.layer === l} className={view.layer === l ? 'on' : ''} onClick={() => switchLayer(l)}>
              {LAYER_LABEL[l]}
            </button>
          ))}
        </div>
        {showTabs && (
          <nav className="tabs" role="tablist">
            {isCity ? <>
              <button role="tab" aria-selected={view.tab === 'trips'} className={view.tab === 'trips' ? 'on' : ''} onClick={() => go({ tab: 'trips' })}>
                帖子 <small>{filtered.length}</small>
              </button>
              <button role="tab" aria-selected={view.tab === 'places'} className={view.tab === 'places' ? 'on' : ''} onClick={() => go({ tab: 'places' })}>
                地点 <small>{placeRows.length}</small>
              </button>
            </> : <>
              <button role="tab" aria-selected={view.ttab === 'trips'} className={view.ttab === 'trips' ? 'on' : ''} onClick={() => go({ ttab: 'trips' })}>
                帖子 <small>{transitList.length}</small>
              </button>
              <button role="tab" aria-selected={view.ttab === 'edges'} className={view.ttab === 'edges' ? 'on' : ''} onClick={() => go({ ttab: 'edges' })}>
                路段 <small>{edgeList.length}</small>
              </button>
            </>}
          </nav>
        )}
        <div className="panel-scroll">{panel}</div>
      </aside>

      {isCity && (
        <div className="elem-bar" role="group" aria-label="地图上显示的元素">
          {ELEMS.map((e) => (
            <Chip key={e} on={elems.has(e)} onClick={() => setElems((cur) => { const n = new Set(cur); if (n.has(e)) n.delete(e); else n.add(e); return n })}>
              <i className={`elem-ic elem-${e}`} aria-hidden />{ELEM_LABEL[e]}
            </Chip>
          ))}
        </div>
      )}

      {view.layer === 'plan' && (
        <div className="legend" aria-hidden>
          <span><i className="lg-line lg-plan" /> 主线</span>
          <span><i className="lg-line lg-plan lg-dash" /> 跨城</span>
          <span><i className="lg-line lg-alt" /> 备选分支</span>
          <span><i className="lg-stay" /> 住宿（第几晚）</span>
        </div>
      )}

      {comparing && (
        <div className="cmp-dock">
          <Compare
            list={cmpTrips}
            colors={palette.compare}
            onRemove={toggleCmp}
            onTrip={(id) => go({ trip: id, place: null })}
            onPlace={(id) => pickPlace(id)}
            onHoverPlace={setHoverPlace}
            onClose={() => setCmpOpen(false)}
          />
        </div>
      )}

      {isCity && !openTrip && !view.place && !comparing && (
        <div className="legend" aria-hidden>
          <span><i className="lg-line" /> 线越粗，越多攻略在这一段连着走</span>
          <span><i className="lg-dot" /> 点越大，越多帖子提到</span>
        </div>
      )}
      {view.layer === 'transit' && !view.edge && (
        <div className="legend" aria-hidden>
          <span><i className="lg-line" /> 有帖子写了怎么走</span>
          <span><i className="lg-line lg-dash" /> 只是行程经过</span>
          <span>线越粗，经过的帖子越多 · 点一条线看走法</span>
        </div>
      )}
    </div>
  )
}
