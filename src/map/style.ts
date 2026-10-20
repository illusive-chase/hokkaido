import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type { MapPalette } from '../theme'

const OMT = 'openmaptiles'
const name = ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name:ja'], ['get', 'name']]

/** 底图图层。只保留海岸、水系、铁路和少量地名，配色全部来自 palette，换主题时逐项更新。 */
export function baseLayers(p: MapPalette): LayerSpecification[] {
  return [
    { id: 'bg', type: 'background', paint: { 'background-color': p.land } },
    {
      id: 'wood', type: 'fill', source: OMT, 'source-layer': 'landcover', minzoom: 9,
      filter: ['==', ['get', 'class'], 'wood'],
      paint: { 'fill-color': p.wood, 'fill-opacity': 0.7 },
    },
    {
      id: 'water', type: 'fill', source: OMT, 'source-layer': 'water',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: { 'fill-color': p.water },
    },
    {
      id: 'waterway', type: 'line', source: OMT, 'source-layer': 'waterway', minzoom: 9,
      paint: { 'line-color': p.waterLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 14, 1.4] },
    },
    {
      id: 'building', type: 'fill', source: OMT, 'source-layer': 'building', minzoom: 14,
      paint: { 'fill-color': p.building },
    },
    {
      id: 'road-minor', type: 'line', source: OMT, 'source-layer': 'transportation', minzoom: 12,
      filter: ['match', ['get', 'class'], ['minor', 'service', 'tertiary'], true, false],
      paint: { 'line-color': p.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 3] },
    },
    {
      id: 'road-major', type: 'line', source: OMT, 'source-layer': 'transportation', minzoom: 7,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false],
      paint: { 'line-color': p.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 12, 1.6, 16, 5] },
    },
    {
      id: 'rail', type: 'line', source: OMT, 'source-layer': 'transportation', minzoom: 5,
      filter: ['all', ['==', ['get', 'class'], 'rail'], ['!', ['has', 'service']], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: {
        'line-color': p.rail,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 0.9, 15, 1.6],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0.9],
      },
    },
    {
      id: 'rail-tunnel', type: 'line', source: OMT, 'source-layer': 'transportation', minzoom: 8,
      filter: ['all', ['==', ['get', 'class'], 'rail'], ['!', ['has', 'service']], ['==', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-color': p.rail, 'line-width': 0.8, 'line-dasharray': [2, 2], 'line-opacity': 0.6 },
    },
    {
      id: 'water-name', type: 'symbol', source: OMT, 'source-layer': 'water_name',
      filter: ['match', ['get', 'class'], ['ocean', 'sea', 'bay', 'lake'], true, false],
      layout: {
        'text-field': name as never,
        'text-font': ['Noto Sans Italic'],
        'text-size': ['match', ['get', 'class'], 'ocean', 14, 'sea', 13, 11],
        'text-letter-spacing': 0.3,
        'text-max-width': 6,
      },
      paint: { 'text-color': p.waterLabel, 'text-halo-color': p.water, 'text-halo-width': 1 },
    },
    {
      id: 'place-name', type: 'symbol', source: OMT, 'source-layer': 'place', minzoom: 6,
      filter: ['match', ['get', 'class'], ['city', 'town'], true, false],
      layout: {
        'text-field': name as never,
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 12, 12],
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2, 'text-opacity': 0.75 },
    },
    {
      id: 'village-name', type: 'symbol', source: OMT, 'source-layer': 'place', minzoom: 11,
      filter: ['match', ['get', 'class'], ['village', 'suburb', 'neighbourhood'], true, false],
      layout: { 'text-field': name as never, 'text-font': ['Noto Sans Regular'], 'text-size': 10.5 },
      paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1, 'text-opacity': 0.6 },
    },
  ] as LayerSpecification[]
}

export function baseStyle(p: MapPalette): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      [OMT]: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
        attribution: '© <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      },
    },
    layers: baseLayers(p),
  }
}
