// Coordinated architectural palettes, shared by the map and detail worker.
export const finishes = [
  { wall: '#b57459', roof: '#66564c', trim: '#dfc8a7', glass: '#455457', material: 'brick' },
  { wall: '#d5c5a6', roof: '#766d60', trim: '#eee1c7', glass: '#596769', material: 'limestone' },
  { wall: '#ded8ca', roof: '#737b7b', trim: '#f1eadc', glass: '#4c646a', material: 'plaster' },
  { wall: '#ad735e', roof: '#914f38', trim: '#d6b496', glass: '#4a6260', material: 'terracotta' },
  { wall: '#bdad95', roof: '#695f59', trim: '#d9d0bc', glass: '#57615e', material: 'sandstone' },
  { wall: '#c4c1b8', roof: '#727576', trim: '#e2dfd5', glass: '#516975', material: 'concrete' },
  { wall: '#e0d0af', roof: '#a16449', trim: '#f0e6d0', glass: '#506561', material: 'stucco' },
  { wall: '#95634f', roof: '#4f5558', trim: '#c4b19a', glass: '#40545b', material: 'brick' },
  { wall: '#8da7af', roof: '#647680', trim: '#bccbd0', glass: '#426776', material: 'glass' },
  { wall: '#a5b4b9', roof: '#647175', trim: '#d0d8d8', glass: '#577984', material: 'glass' },
  { wall: '#b6ada0', roof: '#686766', trim: '#ddd6c9', glass: '#596d73', material: 'stone' },
  { wall: '#c5beb0', roof: '#7a807a', trim: '#e4dfd3', glass: '#465e65', material: 'concrete' },
] as const

export function appearanceSeed(value: string | number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(Math.abs(value))
  let hash = 2166136261
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

export function generatedFinish(tags: Record<string, unknown>, seed: number) {
  const height = Number(tags.height ?? tags.render_height) || 0
  const kind = String(tags.building || '')
  const modern = height >= 65 || /office|commercial/.test(kind)
  return finishes[modern ? 8 + seed % 4 : seed % 8]
}

const materialColors: Record<string, string> = { brick: '#b18775', concrete: '#bcbdb6', stone: '#c7bca5', glass: '#789cae', wood: '#a28b70', metal: '#99a9b2', plaster: '#e0d8c8', roof_tiles: '#ad7660', slate: '#626e7a', copper: '#78a595' }
const namedColors: Record<string, string> = { white: '#eee9df', black: '#333638', grey: '#8b8e8c', gray: '#8b8e8c', red: '#a65d4c', brown: '#8e6c50', beige: '#d5c5a6', cream: '#e6d8b9', yellow: '#ddc589', green: '#708674', blue: '#6d8c9c', orange: '#bd8254' }
export function mappedColor(value?: string): string | undefined {
  const input = value?.trim().toLowerCase()
  if (!input) return undefined
  if (/^#[0-9a-f]{6}$/.test(input)) return input
  if (/^#[0-9a-f]{3}$/.test(input)) return '#' + [...input.slice(1)].map(char => char + char).join('')
  return namedColors[input]
}

export function buildingAppearance(tags: Record<string, string>, identity: string | number = tags.id || tags.name || 'building') {
  const seed = appearanceSeed(identity)
  const finish = generatedFinish(tags, seed)
  const facadeColor = mappedColor(tags['building:colour'] || tags.colour) || materialColors[tags['building:material']] || finish.wall
  const roofColor = mappedColor(tags['roof:colour']) || materialColors[tags['roof:material']] || finish.roof
  return { facadeColor, roofColor, trimColor: finish.trim, windowColor: finish.glass, facadeMaterial: tags['building:material'] || finish.material, appearanceSeed: seed,
    appearanceSource: mappedColor(tags['building:colour'] || tags.colour) ? 'tagged color' : tags['building:material'] ? 'material palette' : 'generated' }
}

// Stable feature IDs provide variety without recalculating colors while the camera moves.
const seedExpression = ['floor', ['abs', ['to-number', ['id'], ['get', 'osm_id'], ['*', ['to-number', ['get', 'render_height'], 0], 13]]]]
const paletteExpression = (start: number, count: number): unknown[] => ['match', ['%', seedExpression, count], ...Array.from({ length: count - 1 }, (_, index) => [index, finishes[start + index].wall]).flat(), finishes[start + count - 1].wall]
export const realisticBuildingColor = ['to-color', ['get', 'colour'], ['get', 'building:colour'], ['case', ['>=', ['to-number', ['get', 'render_height'], 0], 65], paletteExpression(8, 4), paletteExpression(0, 8)]]
