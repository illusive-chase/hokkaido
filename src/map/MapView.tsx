import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type LayerSpecification, type Map as MlMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { baseLayers, baseStyle } from './style'
import { addIcons } from './icons'
import { ALT_META } from '../plan'
import { areaPoints, boundsOfPts, corridors, netEdges, netNodes, placePoints, planAlts, planLines, planStays, planStops, routes, type RouteSpec } from './geo'
import type { MapPalette } from '../theme'
import type { Elem } from '../data'
import type { EdgeView } from '../transit'
import type { SgPlan, Trip } from '../types'

type LngLat = [number, number]
export type Layer = 'plan' | 'transit' | 'city'
const HOKKAIDO: [LngLat, LngLat] = [[139.6, 41.35], [145.6, 45.45]]
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
/** 走廊在街道级别淡出，免得长线压住城市里的细节 */
function corridorOpacity(dim: boolean) {
  const byCount = (k: number) => dim
    ? ['interpolate', ['linear'], ['get', 'count'], 1, 0.05 * k, 16, 0.12 * k]
    : ['interpolate', ['linear'], ['get', 'count'], 1, 0.16 * k, 6, 0.32 * k, 16, 0.42 * k]
  return ['interpolate', ['linear'], ['zoom'], 9, byCount(1), 12, byCount(0.35)]
}

/** 城市内图层的总览模式下，低于这个缩放级别按区域聚合显示 */
const AREA_ZOOM = 8.2
const AREA_LAYERS = ['area', 'area-label']
const DETAIL_LAYERS = ['corridor', 'place', 'place-icon', 'place-label', 'shop-label']
const CITY_LAYERS = [...AREA_LAYERS, ...DETAIL_LAYERS, 'route-casing', 'route', 'place-halo', 'place-hl', 'place-hl-label']
const NET_LAYERS = ['net-edge-casing', 'net-edge-dash', 'net-edge', 'net-hit', 'net-node', 'net-node-label']
const PLAN_LAYERS = ['plan-alt-casing', 'plan-alt', 'plan-alt-hit', 'plan-line-casing', 'plan-line', 'plan-stop', 'plan-stop-label', 'plan-stay', 'plan-stay-mark', 'plan-stay-label']
/** 城际图层只留海陆轮廓：城市和城市之间的边就是全部内容 */
const BASE_DETAIL = ['wood', 'waterway', 'building', 'road-minor', 'road-major', 'rail', 'rail-tunnel', 'place-name', 'village-name']
/** 建议路线图层要看到路网和铁路，但不要建筑和底图地名 */
const PLAN_BASE = ['wood', 'waterway', 'road-minor', 'road-major', 'rail', 'rail-tunnel']
const CLICKABLE_PLACE = ['place', 'place-icon', 'place-hl']

function overlayLayers(p: MapPalette): LayerSpecification[] {
  const radius = ['interpolate', ['linear'], ['get', 'n'], 0, 2.6, 1, 3.4, 3, 5, 8, 7.5, 20, 11]
  const isHl = ['any', ['get', 'sel'], ['!=', ['get', 'hl'], '']]
  const hlColor = ['case', ['!=', ['get', 'hl'], ''], ['get', 'hl'], p.accent]
  const isIcon = ['match', ['get', 'elem'], ['food', 'stay'], true, false]
  const netW = ['interpolate', ['linear'], ['get', 'count'], 1, 1.2, 4, 2.6, 10, 5, 24, 9]
  return [
    // —— 城市内 ——
    {
      id: 'corridor', type: 'line', source: 'corridor',
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': p.corridor,
        'line-width': ['interpolate', ['linear'], ['get', 'count'], 1, 0.7, 3, 1.8, 8, 4, 16, 7],
        'line-opacity': corridorOpacity(false),
      },
    },
    {
      id: 'route-casing', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.ring, 'line-width': ['+', ['get', 'width'], 3], 'line-opacity': 0.9 },
    },
    {
      id: 'route', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] },
    },
    {
      id: 'area', type: 'circle', source: 'area',
      filter: ['>', ['get', 'n'], 0],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 1, 4, 5, 7, 15, 12, 35, 18],
        'circle-color': p.ink,
        'circle-opacity': 0.88,
        'circle-stroke-color': p.ring,
        'circle-stroke-width': 1.5,
      },
    },
    {
      id: 'place-halo', type: 'circle', source: 'place',
      filter: isHl,
      paint: {
        'circle-radius': ['+', ['case', ['==', ['get', 'elem'], 'sight'], radius, 4.5], ['case', ['get', 'sel'], 7, 4]],
        'circle-color': hlColor,
        'circle-opacity': ['case', ['get', 'sel'], 0.22, 0.16],
      },
    },
    // 景点：实心圆，大小按帖子数；交通：小空心圆
    {
      id: 'place', type: 'circle', source: 'place',
      filter: ['all', ['!', isHl], ['!', isIcon]],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'elem'], 'transport'], 3.4, radius],
        'circle-color': ['case', ['==', ['get', 'elem'], 'transport'], p.ring, ['get', 'active'], p.ink, p.muted],
        'circle-opacity': ['case', ['get', 'active'], 1, 0.5],
        'circle-stroke-color': ['case', ['==', ['get', 'elem'], 'transport'], ['case', ['get', 'active'], p.ink, p.muted], p.ring],
        'circle-stroke-width': ['case', ['==', ['get', 'elem'], 'transport'], 1.5, 1.2],
        'circle-stroke-opacity': ['case', ['get', 'active'], 1, 0.6],
      },
    },
    // 饮食：菱形；住宿：方块
    {
      id: 'place-icon', type: 'symbol', source: 'place',
      filter: isIcon,
      layout: {
        'icon-image': ['case', ['==', ['get', 'elem'], 'food'], 'ic-food', 'ic-stay'],
        'icon-size': ['case', ['get', 'sel'], 0.7, 0.5],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: {
        'icon-color': ['case', isHl, hlColor, ['get', 'active'], p.ink, p.muted],
        'icon-opacity': ['case', ['any', isHl, ['get', 'active']], 1, 0.55],
        'icon-halo-color': p.ring,
        'icon-halo-width': 1.4,
      },
    },
    {
      id: 'place-hl', type: 'circle', source: 'place',
      filter: ['all', isHl, ['!', isIcon]],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'elem'], 'transport'], 3.8, ['max', radius, 4]],
        'circle-color': ['case', ['==', ['get', 'elem'], 'transport'], p.ring, hlColor],
        'circle-stroke-color': ['case', ['==', ['get', 'elem'], 'transport'], hlColor, p.ring],
        'circle-stroke-width': ['case', ['==', ['get', 'elem'], 'transport'], 1.8, 1.4],
      },
    },
    {
      id: 'area-label', type: 'symbol', source: 'area',
      filter: ['>', ['get', 'n'], 0],
      layout: {
        'text-field': ['format', ['get', 'name'], {}, '  ', {}, ['to-string', ['get', 'n']], { 'font-scale': 0.82 }],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['get', 'n'], 1, 11.5, 20, 13.5],
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': ['interpolate', ['linear'], ['get', 'n'], 1, 0.7, 35, 1.5],
        'symbol-sort-key': ['-', 0, ['get', 'n']],
      },
      paint: { 'text-color': p.ink, 'text-halo-color': p.ring, 'text-halo-width': 1.8 },
    },
    {
      id: 'place-label', type: 'symbol', source: 'place',
      filter: ['all', ['!', isHl], ['get', 'active'], ['!', isIcon], ['>=', ['get', 'n'], 2]],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['case', ['>=', ['get', 'n'], 8], 12.5, 11.5],
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': ['interpolate', ['linear'], ['get', 'n'], 0, 0.6, 8, 0.9, 20, 1.2],
        'text-justify': 'auto',
        'symbol-sort-key': ['-', 0, ['get', 'rank']],
        'text-max-width': 9,
      },
      paint: { 'text-color': p.ink, 'text-halo-color': p.ring, 'text-halo-width': 1.6 },
    },
    // 饮食、住宿的名字只在街道级别显示，免得挤掉景点名
    {
      id: 'shop-label', type: 'symbol', source: 'place', minzoom: 12.5,
      filter: ['all', ['!', isHl], ['get', 'active'], isIcon],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.7,
        'text-justify': 'auto',
        'text-max-width': 8,
      },
      paint: { 'text-color': p.ink, 'text-halo-color': p.ring, 'text-halo-width': 1.6, 'text-opacity': 0.85 },
    },
    {
      id: 'place-hl-label', type: 'symbol', source: 'place',
      filter: isHl,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['case', ['get', 'sel'], 13.5, 12],
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.9,
        'text-justify': 'auto',
        'symbol-sort-key': ['-', 0, ['get', 'rank']],
        'text-max-width': 9,
      },
      paint: { 'text-color': p.ink, 'text-halo-color': p.ring, 'text-halo-width': 1.8 },
    },

    // —— 建议路线 ——
    { id: 'plan-line-casing', type: 'line', source: 'plan-line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.ring, 'line-width': ['+', ['case', ['get', 'cross'], 3.2, 2.2], 3], 'line-opacity': ['case', ['get', 'lit'], 0.85, 0.45] },
    },
    {
      id: 'plan-line', type: 'line', source: 'plan-line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': p.plan,
        'line-width': ['case', ['get', 'cross'], 3.2, 2.2],
        'line-opacity': ['case', ['get', 'dim'], 0.16, 1],
        'line-dasharray': ['case', ['get', 'cross'], ['literal', [2.2, 1.4]], ['literal', [1, 0]]],
      },
    },
    {
      id: 'plan-alt-casing', type: 'line', source: 'plan-alt',
      paint: { 'line-color': p.ring, 'line-width': ['case', ['get', 'sel'], 6, 4], 'line-opacity': ['case', ['get', 'sel'], 0.9, 0.5] },
    },
    // 分支一律虚线：颜色再配图例，也不只靠颜色区分
    {
      id: 'plan-alt', type: 'line', source: 'plan-alt',
      paint: {
        'line-color': p.planAlt,
        'line-width': ['case', ['get', 'sel'], 2.6, 1.6],
        'line-opacity': ['case', ['get', 'sel'], 1, ['get', 'lit'], 0.8, ['get', 'dim'], 0.08, 0.3],
        'line-dasharray': ['literal', [1.4, 1.6]],
      },
    },
    { id: 'plan-alt-hit', type: 'line', source: 'plan-alt',
      paint: { 'line-color': p.ink, 'line-width': 16, 'line-opacity': 0.001 } },
    {
      id: 'plan-stop', type: 'circle', source: 'plan-stop',
      paint: {
        'circle-radius': ['case', ['all', ['get', 'alt'], ['get', 'lit']], 4.2, ['get', 'lit'], 9.5, ['case', ['get', 'alt'], 3, 5]],
        'circle-color': ['case', ['get', 'alt'], p.planAlt, p.plan],
        'circle-opacity': ['case', ['get', 'lit'], 1, 0.42],
        'circle-stroke-color': p.ring,
        'circle-stroke-width': ['case', ['get', 'lit'], 2, 1.2],
      },
    },
    {
      id: 'plan-stop-label', type: 'symbol', source: 'plan-stop',
      filter: ['get', 'label'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['case', ['get', 'alt'], 11, 12],
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.85,
        'text-justify': 'auto',
        'text-max-width': 9,
      },
      paint: { 'text-color': ['case', ['get', 'alt'], p.planAlt, p.ink], 'text-halo-color': p.ring, 'text-halo-width': 1.8 },
    },
    {
      id: 'plan-stay', type: 'circle', source: 'plan-stay',
      filter: ['==', ['get', 'kind'], 'stay'],
      paint: {
        'circle-radius': 13,
        'circle-color': p.land,
        'circle-opacity': ['case', ['get', 'lit'], 1, 0.5],
        'circle-stroke-color': ['case', ['get', 'lit'], p.plan, p.muted],
        'circle-stroke-width': 2,
      },
    },
    {
      id: 'plan-stay-mark', type: 'symbol', source: 'plan-stay',
      filter: ['==', ['get', 'kind'], 'stay'],
      layout: { 'text-field': ['get', 'mark'], 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'text-allow-overlap': true, 'symbol-sort-key': ['-', 0, ['get', 'day']] },
      paint: { 'text-color': ['case', ['get', 'lit'], p.ink, p.muted], 'text-halo-color': p.ring, 'text-halo-width': 1.2 },
    },
    {
      id: 'plan-stay-label', type: 'symbol', source: 'plan-stay',
      filter: ['==', ['get', 'kind'], 'stay'],
      layout: {
        'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 1.5, 'text-justify': 'auto', 'text-max-width': 9,
      },
      paint: { 'text-color': ['case', ['get', 'lit'], p.ink, p.muted], 'text-halo-color': p.ring, 'text-halo-width': 1.6 },
    },

    // —— 城际通行 ——
    {
      id: 'net-edge-casing', type: 'line', source: 'net-edge',
      filter: ['get', 'lit'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': p.ring, 'line-width': ['+', netW, 4] },
    },
    // 有帖子写了怎么走：实线；只是行程经过：虚线
    {
      id: 'net-edge-dash', type: 'line', source: 'net-edge',
      filter: ['==', ['get', 'legs'], 0],
      paint: {
        'line-color': ['case', ['get', 'lit'], p.accent, p.corridor],
        'line-width': netW,
        'line-opacity': ['case', ['get', 'lit'], 1, ['get', 'dim'], 0.12, 0.38],
        'line-dasharray': [1.2, 1.4],
      },
    },
    {
      id: 'net-edge', type: 'line', source: 'net-edge',
      filter: ['>', ['get', 'legs'], 0],
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': ['case', ['get', 'lit'], p.accent, p.corridor],
        'line-width': netW,
        'line-opacity': ['case', ['get', 'lit'], 1, ['get', 'dim'], 0.12, 0.55],
      },
    },
    // 看不见的粗线：让细边也好点
    {
      id: 'net-hit', type: 'line', source: 'net-edge',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': p.ink, 'line-width': ['max', 16, ['+', netW, 10]], 'line-opacity': 0.001 },
    },
    {
      id: 'net-node', type: 'circle', source: 'net-node',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 1, 4, 5, 6.5, 15, 10, 40, 15],
        'circle-color': ['case', ['get', 'sel'], p.accent, p.ink],
        'circle-opacity': ['case', ['get', 'dim'], 0.35, 0.92],
        'circle-stroke-color': p.ring,
        'circle-stroke-width': ['case', ['get', 'sel'], 2.5, 1.5],
      },
    },
    {
      id: 'net-node-label', type: 'symbol', source: 'net-node',
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['get', 'n'], 1, 11.5, 30, 14],
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': ['interpolate', ['linear'], ['get', 'n'], 1, 0.7, 40, 1.3],
        'symbol-sort-key': ['-', 0, ['get', 'n']],
      },
      paint: {
        'text-color': p.ink,
        'text-opacity': ['case', ['get', 'dim'], 0.5, 1],
        'text-halo-color': p.ring,
        'text-halo-width': 1.8,
      },
    },
  ] as LayerSpecification[]
}

/** 视野：key 变化时执行一次。fit 会缩放到这些点；reveal 只在点不在视野里时平移，不改变缩放 */
export interface Focus { key: string; pts: LngLat[]; mode: 'fit' | 'reveal'; maxZoom?: number }

export interface MapViewProps {
  palette: MapPalette
  layer: Layer
  areaNames: Map<string, string>
  padding: { left: number; top: number; right: number; bottom: number }
  focus: Focus | null

  // 城市内
  /** 总览：低缩放级别按区域聚合 */
  overview: boolean
  trips: Trip[]
  routeSpecs: RouteSpec[]
  dimCorridors: boolean
  elems: Set<Elem>
  activePlaces: Set<string> | null
  highlight: Map<string, string>
  selectedPlace: string | null
  onPickPlace: (id: string) => void
  onHoverPlace: (id: string | null) => void

  // 城际通行
  edges: EdgeView[]
  selectedEdge: string | null
  hoverEdge: string | null
  litEdges: Set<string>
  litCities: Set<string>
  selectedCity: string | null
  onPickEdge: (key: string) => void
  onHoverEdge: (key: string | null) => void
  onPickCity: (id: string) => void

  // 建议路线
  plan: SgPlan | null
  planDay: number | null
  planAlt: string | null
  onPickAlt: (key: string) => void
  onHoverAlt: (key: string | null) => void
  onPickPlanDay: (day: number) => void
}

export default function MapView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const ready = useRef(false)
  const propsRef = useRef(props)
  propsRef.current = props
  const popup = useRef<maplibregl.Popup | null>(null)

  // 初始化
  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: baseStyle(props.palette),
      bounds: HOKKAIDO,
      fitBoundsOptions: { padding: props.padding },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      maxZoom: 16.5,
      minZoom: 4.5,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    mapRef.current = map
    // 开发时或带 ?debug 打开，可以在控制台用 __map 检查视野（无头浏览器验证时也用它）
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) (window as unknown as { __map: MlMap }).__map = map
    popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'map-tip' })

    map.on('load', () => {
      addIcons(map)
      for (const id of ['area', 'corridor', 'route', 'place', 'net-edge', 'net-node', 'plan-line', 'plan-alt', 'plan-stop', 'plan-stay']) map.addSource(id, { type: 'geojson', data: EMPTY })
      for (const l of overlayLayers(propsRef.current.palette)) map.addLayer(l)
      ready.current = true
      sync()
    })
    const tip = (html: string, at: LngLat) => popup.current!.setLngLat(at).setHTML(html).addTo(map)
    const untip = () => { map.getCanvas().style.cursor = ''; popup.current!.remove() }
    const pointOf = (f: maplibregl.MapGeoJSONFeature) => (f.geometry as GeoJSON.Point).coordinates as LngLat

    // 地点：点击只打开详情，不移动地图
    for (const layer of CLICKABLE_PLACE) {
      map.on('mousemove', layer, (e) => {
        const f = e.features?.[0]
        if (!f) return
        map.getCanvas().style.cursor = 'pointer'
        const p = f.properties as { id: string; name: string; n: number; total: number }
        propsRef.current.onHoverPlace(p.id)
        tip(`<b>${p.name}</b><span>${p.n} 篇帖子${p.total !== p.n ? `（共 ${p.total}）` : ''}</span>`, pointOf(f))
      })
      map.on('mouseleave', layer, () => { untip(); propsRef.current.onHoverPlace(null) })
      map.on('click', layer, (e) => {
        const id = e.features?.[0]?.properties?.id
        if (id) propsRef.current.onPickPlace(id)
      })
    }
    // 聚合的区域：点击放大
    map.on('mousemove', 'area', (e) => {
      const f = e.features?.[0]
      if (!f) return
      map.getCanvas().style.cursor = 'zoom-in'
      const p = f.properties as { name: string; n: number }
      tip(`<b>${p.name}</b><span>${p.n} 篇帖子经过 · 点击放大</span>`, pointOf(f))
    })
    map.on('mouseleave', 'area', untip)
    map.on('click', 'area', (e) => {
      const f = e.features?.[0]
      if (!f) return
      popup.current!.remove()
      map.easeTo({ center: pointOf(f), zoom: Math.max(AREA_ZOOM + 1.6, map.getZoom() + 2), duration: 800 })
    })

    // 城际：边和城市都可以点，都不移动地图
    let onCity = false
    map.on('mousemove', 'net-node', (e) => {
      const f = e.features?.[0]
      if (!f) return
      onCity = true
      map.getCanvas().style.cursor = 'pointer'
      propsRef.current.onHoverEdge(null)
      const p = f.properties as { name: string; n: number }
      tip(`<b>${p.name}</b><span>${p.n} 篇帖子经过 · 点击看它连着哪些城市</span>`, pointOf(f))
    })
    map.on('mouseleave', 'net-node', () => { onCity = false; untip() })
    map.on('click', 'net-node', (e) => {
      const id = e.features?.[0]?.properties?.id
      if (id) propsRef.current.onPickCity(id)
    })
    map.on('mousemove', 'net-hit', (e) => {
      if (onCity) return
      const f = e.features?.[0]
      if (!f) return
      map.getCanvas().style.cursor = 'pointer'
      const p = f.properties as { key: string; a: string; b: string; count: number; legs: number; warn: number }
      propsRef.current.onHoverEdge(p.key)
      const names = propsRef.current.areaNames
      const sub = [`${p.count} 篇经过`, p.legs ? `${p.legs} 篇写了怎么走` : '没有帖子写怎么走', p.warn ? `${p.warn} 条注意` : ''].filter(Boolean).join(' · ')
      tip(`<b>${names.get(p.a)} — ${names.get(p.b)}</b><span>${sub}</span>`, [e.lngLat.lng, e.lngLat.lat])
    })
    map.on('mouseleave', 'net-hit', () => { untip(); propsRef.current.onHoverEdge(null) })
    map.on('click', 'net-hit', (e) => {
      // 点在城市上时交给城市
      if (map.queryRenderedFeatures(e.point, { layers: ['net-node'] }).length) return
      const key = e.features?.[0]?.properties?.key
      if (key) propsRef.current.onPickEdge(key)
    })

    // 建议路线的地点和住处：悬停显示是哪天的安排，点击打开当天
    for (const layer of ['plan-stop', 'plan-stay']) {
      map.on('mousemove', layer, (e) => {
        const f = e.features?.[0]
        if (!f) return
        map.getCanvas().style.cursor = 'pointer'
        const p = f.properties as { name: string; when?: string; kind?: string; mark?: string }
        const sub = p.when ?? (p.kind === 'end' ? (p.mark === '进' ? '第一天从这里进' : '最后一天从这里走') : `住第 ${p.mark} 晚`)
        tip(`<b>${p.name}</b><span>${sub} · 点击看这一天</span>`, pointOf(f))
      })
      map.on('mouseleave', layer, untip)
      map.on('click', layer, (e) => {
        if (layer === 'plan-stop' && map.queryRenderedFeatures(e.point, { layers: ['plan-stay'] }).length) return
        const day = e.features?.[0]?.properties?.day
        if (day != null) propsRef.current.onPickPlanDay(Number(day))
      })
    }
    // 建议路线：悬停分支看它是什么情况下的备选，点它选中
    map.on('mousemove', 'plan-alt-hit', (e) => {
      const f = e.features?.[0]
      if (!f) return
      map.getCanvas().style.cursor = 'pointer'
      const p = f.properties as { key: string; kind: string; day: number }
      propsRef.current.onHoverAlt(p.key)
      const meta = ALT_META[p.kind as keyof typeof ALT_META]
      tip(`<b>${meta.icon} D${p.day} · ${meta.label}</b><span>点击选为这次的分支</span>`, [e.lngLat.lng, e.lngLat.lat])
    })
    map.on('mouseleave', 'plan-alt-hit', () => { untip(); propsRef.current.onHoverAlt(null) })
    map.on('click', 'plan-alt-hit', (e) => {
      const key = e.features?.[0]?.properties?.key
      if (key) propsRef.current.onPickAlt(key)
    })

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; ready.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function sync() {
    const map = mapRef.current
    if (!map || !ready.current) return
    const p = propsRef.current
    const city = p.layer === 'city'
    const vis = (ids: string[], on: boolean) => { for (const id of ids) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none') }
    vis(CITY_LAYERS, city)
    vis(NET_LAYERS, p.layer === 'transit')
    vis(PLAN_LAYERS, p.layer === 'plan')
    vis(BASE_DETAIL, city)
    if (p.layer === 'plan') vis(PLAN_BASE, true)
    if (p.layer === 'plan') {
      const o = { day: p.planDay, alt: p.planAlt, hover: null }
      if (p.plan) {
        ;(map.getSource('plan-line') as GeoJSONSource).setData(planLines(p.plan, o))
        ;(map.getSource('plan-alt') as GeoJSONSource).setData(planAlts(p.plan, o))
        ;(map.getSource('plan-stop') as GeoJSONSource).setData(planStops(p.plan, o))
        ;(map.getSource('plan-stay') as GeoJSONSource).setData(planStays(p.plan, o, p.areaNames))
      }
      return
    }
    if (city) {
      ;(map.getSource('area') as GeoJSONSource).setData(areaPoints(p.trips, p.areaNames))
      ;(map.getSource('corridor') as GeoJSONSource).setData(corridors(p.trips))
      ;(map.getSource('route') as GeoJSONSource).setData(routes(p.routeSpecs))
      ;(map.getSource('place') as GeoJSONSource).setData(placePoints({
        trips: p.trips, elems: p.elems, activePlaces: p.activePlaces, highlight: p.highlight, selected: p.selectedPlace,
      }))
      vis(AREA_LAYERS, p.overview)
      for (const id of AREA_LAYERS) map.setLayerZoomRange(id, 0, AREA_ZOOM)
      for (const id of DETAIL_LAYERS) map.setLayerZoomRange(id, p.overview ? AREA_ZOOM : id === 'shop-label' ? 12.5 : 0, 24)
      map.setPaintProperty('area', 'circle-opacity', p.routeSpecs.length ? 0.3 : 0.88)
      map.setPaintProperty('corridor', 'line-opacity', corridorOpacity(p.dimCorridors))
    } else if (p.layer === 'transit') {
      ;(map.getSource('net-edge') as GeoJSONSource).setData(netEdges(p.edges, { edge: p.selectedEdge, hl: p.litEdges, hover: p.hoverEdge }))
      ;(map.getSource('net-node') as GeoJSONSource).setData(netNodes(p.edges, p.areaNames, { city: p.selectedCity, lit: p.litCities }))
    }
  }

  useEffect(sync, [
    props.layer, props.overview, props.trips, props.routeSpecs, props.dimCorridors, props.elems, props.activePlaces, props.highlight, props.selectedPlace,
    props.edges, props.selectedEdge, props.hoverEdge, props.litEdges, props.litCities, props.selectedCity,
    props.plan, props.planDay, props.planAlt,
  ])

  // 换主题：逐项重设底图和覆盖层的 paint
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const palette = propsRef.current.palette
      for (const l of [...baseLayers(palette), ...(ready.current ? overlayLayers(palette) : [])]) {
        if (!map.getLayer(l.id)) continue
        for (const [k, v] of Object.entries((l as { paint?: Record<string, unknown> }).paint ?? {})) {
          map.setPaintProperty(l.id, k, v)
        }
      }
      if (ready.current) sync()
    }
    // isStyleLoaded() can temporarily be false while sources or tiles update. The
    // map-level load event only fires once, so waiting for it again loses theme changes.
    if (ready.current) apply()
    else map.once('load', apply)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.palette])

  // 切到城际、建议路线图层时，如果还停在某个城市里，退回全岛
  useEffect(() => {
    const map = mapRef.current
    if (!map || props.layer === 'city') return
    const go = () => { if (map.getZoom() > 8.6) map.fitBounds(HOKKAIDO, { padding: propsRef.current.padding, duration: 900 }) }
    if (ready.current) go()
    else map.once('load', go)
  }, [props.layer])

  // 视野
  useEffect(() => {
    const map = mapRef.current
    const f = props.focus
    if (!map || !f || !f.pts.length) return
    const go = () => {
      const pad = propsRef.current.padding
      if (f.mode === 'reveal') {
        reveal(map, f.pts, pad)
        return
      }
      const b = boundsOfPts(f.pts)!
      const single = b[0][0] === b[1][0] && b[0][1] === b[1][1]
      if (single) map.easeTo({ center: b[0], zoom: Math.max(map.getZoom(), Math.min(12.5, f.maxZoom ?? 12.5)), padding: pad, duration: 900 })
      else map.fitBounds(b, { padding: { ...pad, left: pad.left + 40, right: pad.right + 40, top: pad.top + 40, bottom: pad.bottom + 40 }, maxZoom: f.maxZoom ?? 13.5, duration: 900 })
    }
    if (ready.current) go()
    else map.once('load', go)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus?.key])

  return <div ref={el} className="map" />
}

/** 点都在可见范围（扣掉面板）里就不动；否则平移过去，不放大 */
function reveal(map: MlMap, pts: LngLat[], pad: MapViewProps['padding']) {
  const c = map.getCanvas()
  const w = c.clientWidth, h = c.clientHeight
  const inView = pts.every((pt) => {
    const s = map.project(pt)
    return s.x >= pad.left && s.x <= w - pad.right && s.y >= pad.top && s.y <= h - pad.bottom
  })
  if (inView) return
  const b = boundsOfPts(pts)!
  if (pts.length === 1) map.easeTo({ center: pts[0], padding: pad, duration: 700 })
  else map.fitBounds(b, { padding: { ...pad, left: pad.left + 40, right: pad.right + 40, top: pad.top + 40, bottom: pad.bottom + 40 }, maxZoom: map.getZoom(), duration: 700 })
}
