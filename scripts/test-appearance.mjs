import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildingAppearance, mappedColor } from '../src/appearance.ts'

test('generated appearances are stable, varied and coordinated', () => {
  const first = buildingAppearance({}, 'way/123')
  assert.deepEqual(first, buildingAppearance({}, 'way/123'))
  const walls = new Set(Array.from({ length: 40 }, (_, id) => buildingAppearance({}, id).facadeColor))
  assert.equal(walls.size, 8)
  assert.notEqual(first.facadeColor, first.roofColor)
  assert.equal(first.appearanceSource, 'generated')
})
test('towers use modern finishes and mapped colors take precedence', () => {
  assert.equal(buildingAppearance({ height: '100' }, 0).facadeMaterial, 'glass')
  const mapped = buildingAppearance({ 'building:colour': '#abc', 'roof:colour': 'red' }, 0)
  assert.equal(mapped.facadeColor, '#aabbcc')
  assert.equal(mapped.roofColor, '#a65d4c')
  assert.equal(mapped.appearanceSource, 'tagged color')
  assert.equal(mappedColor('url(unsafe)'), undefined)
})
