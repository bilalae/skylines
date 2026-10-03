import osmtogeojson from 'osmtogeojson'
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { buildingAppearance, realisticBuildingColor } from './appearance.ts'
export { buildingAppearance } from './appearance.ts'

export type BuildingData = FeatureCollection<Polygon | MultiPolygon>
export const emptyBuildings: BuildingData = { type: 'FeatureCollection', features: [] }

// A visible fallback, rather than silently flattening footprints with zero height.
export const tileHeight = ['max', 6, ['to-number', ['get', 'render_height'], 0]]
export const tileBase = ['max', 0, ['min', ['-', tileHeight, 1], ['to-number', ['get', 'render_min_height'], 0]]]
export const buildingColor = realisticBuildingColor

function meters(value?: string): number | undefined {
  if (!value) return undefined
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?$/i)
  if (!match) return undefined
  const number = Number(match[1]) * (/^(ft|feet|')$/i.test(match[2] || '') ? .3048 : 1)
  return number > 0 && number < 1500 ? number : undefined
}

export function buildingDimensions(tags: Record<string, string>) {
  const measured = meters(tags.height)
  const levels = Number(tags['building:levels'])
  const kind = tags.building || tags['building:part']
  const roofShape = tags['roof:shape'] || (/^(house|detached|bungalow|semidetached_house)$/.test(kind || '') ? 'gabled' : 'flat')
  const roof = meters(tags['roof:height']) || (['gabled', 'hipped', 'pyramidal', 'skillion'].includes(roofShape) ? 2.4 : 0)
  const typical = /garage|shed|hut|roof/.test(kind || '') ? 3 : /house|detached|bungalow/.test(kind || '') ? 7 : 10
  const height = measured ?? (levels > 0 && levels < 200 ? levels * 3 + roof : typical)
  const minLevels = Number(tags['building:min_level'])
  const base = Math.min(height - 1, meters(tags.min_height) ?? (minLevels > 0 ? minLevels * 3 : 0))
  return { height, base: Math.max(0, base), heightSource: measured ? 'tagged' : levels > 0 && levels < 200 ? 'levels' : 'estimated' }
}

export function roofDimensions(tags: Record<string, string>, height: number) {
  const residential = /^(house|detached|bungalow|semidetached_house)$/.test(tags.building || '')
  const shape = tags['roof:shape'] || (residential ? 'gabled' : 'flat')
  const supported = ['gabled', 'pyramidal', 'hipped', 'skillion'].includes(shape)
  const roofHeight = supported ? Math.min(meters(tags['roof:height']) || 2.4, height * .45) : 0
  return { roofShape: shape, roofHeight, wallHeight: height - roofHeight, roofSource: tags['roof:shape'] ? 'mapped shape; dimensions may be estimated' : 'generated roof' }
}

export function convertBuildings(raw: object): BuildingData {
  const converted = osmtogeojson(raw, { flatProperties: true })
  return {
    type: 'FeatureCollection',
    features: converted.features.flatMap(feature => {
      const tags = feature.properties || {}
      if (!['Polygon', 'MultiPolygon'].includes(feature.geometry.type) || (!tags.building && !tags['building:part']) || tags.building === 'no' || tags.location === 'underground') return []
      const dimensions = buildingDimensions(tags)
      return [{ ...feature, geometry: feature.geometry as Polygon | MultiPolygon, properties: { ...tags, ...dimensions, ...buildingAppearance({ ...tags, height: String(dimensions.height) }, feature.id || tags.id), ...roofDimensions(tags, dimensions.height) } }]
    }),
  }
}

type DetailResult = { data: BuildingData; region: Polygon }
const cache = new Map<string, DetailResult>()
let nextRequestAt = 0

export async function loadNearbyBuildings(lng: number, lat: number, signal: AbortSignal): Promise<DetailResult> {
  // Small, bounded requests; no planet downloads or requests on every camera frame.
  const longitude = ((lng + 180) % 360 + 360) % 360 - 180
  const x = Math.round(longitude * 250) / 250
  const y = Math.round(lat * 250) / 250
  const dx = .004 / Math.max(.2, Math.cos(y * Math.PI / 180))
  const west = Math.max(-180, x - dx), east = Math.min(180, x + dx)
  const south = Math.max(-85, y - .004), north = Math.min(85, y + .004)
  const key = `${x},${y}`
  const cached = cache.get(key)
  if (cached) return cached
  if (Date.now() < nextRequestAt) throw new Error('Please wait a few seconds before enriching another area.')
  nextRequestAt = Date.now() + 10000
  const bbox = `${south},${west},${north},${east}`
  const query = `[out:json][timeout:20];(nwr["building"]["building"!="no"](${bbox});nwr["building:part"]["building:part"!="no"](${bbox}););out geom;`
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', body: new URLSearchParams({ data: query }), signal,
  })
  if (!response.ok) {
    if (response.status === 429 || response.status === 406) nextRequestAt = Date.now() + 30000
    throw new Error('Building detail service is busy. Global map buildings remain available.')
  }
  const raw = await response.json()
  if (raw.remark || !Array.isArray(raw.elements)) throw new Error('Building query was incomplete. Please try again later.')
  const result: DetailResult = {
    data: convertBuildings(raw),
    region: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
  }
  if (cache.size >= 12) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}
