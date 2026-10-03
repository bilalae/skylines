import { convertBuildings } from '../src/buildings.ts'

// One small read-only query covers representative neighborhoods on three continents.
const cities = [
  ['Tokyo', 35.6895, 139.6917],
  ['Paris', 48.8566, 2.3522],
  ['Cairo', 30.0444, 31.2357],
]
const clauses = cities.map(([, lat, lng]) => `nwr["building"](${lat - .001},${lng - .001},${lat + .001},${lng + .001});`).join('')
const response = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST', body: new URLSearchParams({ data: `[out:json][timeout:25];(${clauses});out geom;` }),
  headers: { 'User-Agent': 'AtlasMapDevelopment/1.0 (building geometry verification)', Referer: 'http://localhost:5174/' },
  signal: AbortSignal.timeout(35000),
})
if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`)
const raw = await response.json()
if (raw.remark) throw new Error(raw.remark)
const data = convertBuildings(raw)
for (const [name, lat, lng] of cities) {
  const features = data.features.filter(feature => {
    const points = feature.geometry.coordinates.flat(feature.geometry.type === 'MultiPolygon' ? 2 : 1)
    return points.some(([x, y]) => Math.abs(x - lng) < .002 && Math.abs(y - lat) < .002)
  })
  if (!features.length) throw new Error(`${name}: no building geometry returned`)
  console.log(`${name}: ${features.length} building shapes, all positive heights: ${features.every(f => f.properties.height > 0)}`)
}
