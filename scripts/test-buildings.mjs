import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildingDimensions, convertBuildings } from '../src/buildings.ts'

test('height units and floor estimates', () => {
  assert.equal(buildingDimensions({ height: '100 ft' }).height, 30.48)
  assert.equal(buildingDimensions({ height: '25 m', 'building:levels': '2' }).height, 25)
  assert.equal(buildingDimensions({ 'building:levels': '4', 'roof:height': '2' }).height, 14)
})
test('zero, missing, and invalid heights remain visible and labeled', () => {
  for (const height of ['0', '-4', 'unknown', 'Infinity', undefined]) {
    const result = buildingDimensions({ height, building: 'house' })
    assert.equal(result.height, 7)
    assert.equal(result.heightSource, 'estimated')
  }
  assert.equal(buildingDimensions({ height: '10', min_height: '40' }).base, 9)
})
const ring = (id, tags = { building: 'yes' }) => ({
  type: 'way', id, tags, nodes: [1, 2, 3, 1],
  geometry: [{ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, { lon: 0, lat: 1 }, { lon: 0, lat: 0 }],
})
test('footprints get heights; unmapped and underground geometry is excluded', () => {
  const data = convertBuildings({ elements: [ring(1), ring(2, { building: 'no' }), ring(3, { building: 'yes', location: 'underground' })] })
  assert.equal(data.features.length, 1)
  assert.equal(data.features[0].properties.heightSource, 'estimated')
  assert.equal(data.features[0].geometry.type, 'Polygon')
})
test('multipart building relations retain polygon geometry', () => {
  const geometry = ring(1).geometry
  const data = convertBuildings({ elements: [{ type: 'relation', id: 42, tags: { type: 'multipolygon', building: 'yes', height: '18' }, members: [
    { type: 'way', ref: 1, role: 'outer', geometry },
    { type: 'way', ref: 2, role: 'outer', geometry: geometry.map(point => ({ lon: point.lon + 3, lat: point.lat })) },
  ] }] })
  assert.equal(data.features.length, 1)
  assert.equal(data.features[0].geometry.type, 'MultiPolygon')
  assert.equal(data.features[0].properties.height, 18)
})
