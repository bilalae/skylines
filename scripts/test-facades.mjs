import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mercator, planFacades, shapedRoof, packFacades } from '../src/facadeGeometry.ts'
import { buildingAppearance, roofDimensions } from '../src/buildings.ts'

const building = (height = 12, id = 1, offset = 0) => ({
  type: 'Feature', id, properties: { render_height: height },
  geometry: { type: 'Polygon', coordinates: [[[offset, 0], [offset + .0002, 0], [offset + .0002, .0002], [offset, .0002], [offset, 0]]] },
})
test('mercator origin and scale are finite at high latitudes', () => {
  assert.equal(mercator(0, 0).x, .5)
  assert.ok(Math.abs(mercator(0, 0).y - .5) < 1e-10)
  assert.ok(Number.isFinite(mercator(0, 90).scale))
})
test('flat footprint gets window rows and a roof above ground', () => {
  const plan = planFacades([building(0)], 0, 0, 'smooth')
  assert.equal(plan.buildings, 1)
  assert.ok(plan.boxes.some(box => box.window && box.z > 0))
  assert.ok(plan.boxes.some(box => !box.window && box.z > 6))
  assert.ok(plan.roofPositions.length > 0)
  assert.ok(plan.roofPositions.every(Number.isFinite))
})
test('geometry budgets are enforced and far buildings omitted', () => {
  const many = Array.from({ length: 250 }, (_, id) => building(250, id, id * .00001))
  assert.ok(planFacades(many, 0, 0, 'smooth').boxes.length <= 7000)
  assert.ok(planFacades(many, 0, 0, 'detailed').boxes.length <= 18000)
  assert.equal(planFacades([building(10, 1, 20)], 0, 0, 'smooth').buildings, 0)
})
test('duplicate footprints are not rendered twice', () => {
  const one = planFacades([building()], 0, 0, 'smooth')
  const two = planFacades([building(), building()], 0, 0, 'smooth')
  assert.equal(two.boxes.length, one.boxes.length)
})
test('mapped colors take priority over representative material palette', () => {
  const value = buildingAppearance({ 'building:colour': '#ab1234', 'building:material': 'brick', 'roof:material': 'copper' })
  assert.equal(value.facadeColor, '#ab1234')
  assert.equal(value.roofColor, '#78a595')
  assert.equal(value.appearanceSource, 'tagged color')
})
test('roof triangulation preserves courtyard holes', () => {
  const solid = building()
  const courtyard = building()
  courtyard.geometry.coordinates.push([[.00005, .00005], [.00005, .00015], [.00015, .00015], [.00015, .00005], [.00005, .00005]])
  const area = positions => {
    let result = 0
    for (let i = 0; i < positions.length; i += 9) {
      result += Math.abs((positions[i + 3] - positions[i]) * (positions[i + 7] - positions[i + 1]) - (positions[i + 6] - positions[i]) * (positions[i + 4] - positions[i + 1])) / 2
    }
    return result
  }
  const full = area(planFacades([solid], 0, 0, 'smooth').roofPositions)
  const hollow = area(planFacades([courtyard], 0, 0, 'smooth').roofPositions)
  assert.ok(Math.abs(hollow / full - .75) < .001)
})
test('pitched roofs respect eave and total heights; unsupported geometry stays flat', () => {
  const rectangle = [[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]]
  for (const shape of ['gabled', 'hipped', 'pyramidal', 'skillion']) {
    const triangles = shapedRoof(rectangle, 7, 10, shape)
    assert.ok(triangles.length >= 4)
    const heights = triangles.flat().map(point => point[2])
    assert.equal(Math.min(...heights), 7)
    assert.equal(Math.max(...heights), 10)
  }
  assert.equal(shapedRoof([[0, 0], [10, 0], [4, 3], [0, 10], [0, 0]], 7, 10, 'gabled').length, 0)
})
test('roof estimates are labeled and tagged height stays bounded', () => {
  const estimated = roofDimensions({ building: 'house' }, 7)
  assert.equal(estimated.roofShape, 'gabled')
  assert.equal(estimated.roofSource, 'generated roof')
  const tagged = roofDimensions({ 'roof:shape': 'hipped', 'roof:height': '3 m' }, 12)
  assert.equal(tagged.wallHeight, 9)
  assert.equal(roofDimensions({ 'roof:shape': 'hipped', 'roof:height': '300' }, 12).wallHeight, 6.6)
})
test('worker payload has complete finite instance matrices and separate night colors', () => {
  const feature = building()
  feature.properties = { height: 12, wallHeight: 9, roofShape: 'gabled' }
  const plan = planFacades([feature], 0, 0, 'smooth')
  assert.deepEqual(plan.roofIds, ['1'])
  const packed = packFacades(plan)
  assert.equal(packed.matrices.length, plan.boxes.length * 16)
  assert.equal(packed.dayColors.length, plan.boxes.length * 3)
  assert.ok(packed.matrices.every(Number.isFinite))
  assert.notDeepEqual(packed.nightColors, packed.dayColors)
})
