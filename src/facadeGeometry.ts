import { Color, ShapeUtils, Vector2 } from 'three'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { appearanceSeed, generatedFinish } from './appearance.ts'

export type Quality = 'smooth' | 'detailed'
export type Footprint = Feature<Polygon | MultiPolygon>
type Box = { x: number; y: number; z: number; width: number; depth: number; height: number; angle: number; color: string; window: boolean; nightColor?: string }
export type FacadeMap = {
  getCanvas: () => HTMLCanvasElement
  getZoom: () => number
  getCenter: () => { lng: number; lat: number }
  queryRenderedFeatures: (options: { layers: string[] }) => Footprint[]
  triggerRepaint: () => void
  setPaintProperty: (layer: string, property: string, value: unknown) => void
}

type Point3 = [number, number, number]
export function shapedRoof(points: number[][], wall: number, top: number, shape: string, across = false): Point3[][] {
  if (points.length !== 5 || top <= wall) return []
  // Only convex, nearly rectangular footprints can safely use these simple forms.
  const corners = points.slice(0, 4)
  const edges = corners.map((p, i) => [corners[(i + 1) % 4][0] - p[0], corners[(i + 1) % 4][1] - p[1]])
  const lengths = edges.map(e => Math.hypot(...e))
  if (lengths.some(length => length < 2)) return []
  const crosses = edges.map((e, i) => e[0] * edges[(i + 1) % 4][1] - e[1] * edges[(i + 1) % 4][0])
  if (!crosses.every(value => value > 0) && !crosses.every(value => value < 0)) return []
  if (edges.some((e, i) => Math.abs(e[0] * edges[(i + 1) % 4][0] + e[1] * edges[(i + 1) % 4][1]) / (lengths[i] * lengths[(i + 1) % 4]) > .2)) return []
  if ((lengths[0] < lengths[1]) !== across) corners.push(corners.shift()!)
  const p = corners.map(([x, y]) => [x, y, wall] as Point3)
  const mid = (a: Point3, b: Point3): Point3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, top]
  const center: Point3 = [p.reduce((sum, v) => sum + v[0], 0) / 4, p.reduce((sum, v) => sum + v[1], 0) / 4, top]
  if (shape === 'pyramidal') return p.map((v, i) => [v, p[(i + 1) % 4], center])
  if (shape === 'skillion') {
    const high2: Point3 = [p[2][0], p[2][1], top], high3: Point3 = [p[3][0], p[3][1], top]
    return [[p[0], p[1], high2], [p[0], high2, high3], [p[1], p[2], high2], [p[0], high3, p[3]], [p[2], p[3], high3], [p[2], high3, high2]]
  }
  const a = mid(p[0], p[3]), b = mid(p[1], p[2])
  if (shape === 'hipped') {
    a[0] += (center[0] - a[0]) * .4; a[1] += (center[1] - a[1]) * .4
    b[0] += (center[0] - b[0]) * .4; b[1] += (center[1] - b[1]) * .4
  }
  if (shape === 'gabled' || shape === 'hipped') return [[p[0], p[1], b], [p[0], b, a], [p[2], p[3], a], [p[2], a, b], [p[0], a, p[3]], [p[1], p[2], b]]
  return []
}

const circumference = 40075016.686
export function mercator(lng: number, lat: number) {
  const latitude = Math.max(-85, Math.min(85, lat)) * Math.PI / 180
  return { x: (lng + 180) / 360, y: (1 - Math.log(Math.tan(Math.PI / 4 + latitude / 2)) / Math.PI) / 2, scale: 1 / (circumference * Math.cos(latitude)) }
}

export function planFacades(features: Footprint[], lng: number, lat: number, quality: Quality) {
  const origin = mercator(lng, lat)
  const budget = quality === 'smooth' ? 7000 : 18000
  const maxBuildings = quality === 'smooth' ? 90 : 180
  const radius = quality === 'smooth' ? 420 : 650
  const boxes: Box[] = []
  const roofPositions: number[] = []
  const roofColors: number[] = []
  const roofIds: string[] = []
  const tint = new Color()
  const seen = new Set<string>()
  let buildings = 0
  // Near buildings get the budget first. Geometry is generated only after the map settles.
  const ordered = features.map(feature => {
    const ring = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0]?.[0]
    const first = ring?.[0]
    return { feature, distance: first ? (first[0] - lng) ** 2 * Math.cos(lat * Math.PI / 180) ** 2 + (first[1] - lat) ** 2 : Infinity }
  }).sort((a, b) => a.distance - b.distance)
  for (const { feature } of ordered) {
    if (buildings >= maxBuildings || boxes.length >= budget) break
    const properties = feature.properties || {}
    const seed = Number(properties.appearanceSeed) || appearanceSeed(feature.id ?? (Number(properties.render_height) || 0) * 13)
    const finish = generatedFinish(properties, seed)
    const roofColor = properties.roofColor || finish.roof
    const trimColor = properties.trimColor || finish.trim
    const glassColor = properties.windowColor || finish.glass
    const glassFacade = (properties.facadeMaterial || finish.material) === 'glass'
    const rawHeight = Number(properties.height ?? properties.render_height)
    const height = Number.isFinite(rawHeight) && rawHeight > 0 ? Math.max(properties.height === undefined ? 6 : 0, Math.min(1500, rawHeight)) : 6
    const base = Math.max(0, Math.min(height - 1, Number(properties.base ?? properties.render_min_height) || 0))
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
    let added = false
    for (const polygon of polygons) {
      const ring = polygon[0]
      if (!ring || ring.length < 4 || polygon.reduce((total, boundary) => total + boundary.length, 0) > 600) continue
      const key = `${feature.id ?? ''}:${ring[0].join(',')}:${ring.length}`
      if (seen.has(key)) continue
      seen.add(key)
      const points = ring.map(([x, y]) => { const p = mercator(x, y); return [(p.x - origin.x) / origin.scale, -(p.y - origin.y) / origin.scale] })
      if (Math.hypot(points[0][0], points[0][1]) > radius) continue
      // Roof surfaces follow the mapped footprint, including courtyard holes.
      const contour = points.slice(0, -1).map(([x, y]) => new Vector2(x, y))
      const holes = polygon.slice(1).filter(hole => hole.length < 300).map(hole => hole.slice(0, -1).map(([x, y]) => {
        const p = mercator(x, y)
        return new Vector2((p.x - origin.x) / origin.scale, -(p.y - origin.y) / origin.scale)
      }))
      const vertices = [...contour, ...holes.flat()]
      const proposedWall = Number(properties.wallHeight)
      const pitched = polygon.length === 1 && polygons.length === 1 && feature.id !== undefined && Number.isFinite(proposedWall)
        ? shapedRoof(points, Math.max(base, proposedWall), height, properties.roofShape, properties['roof:orientation'] === 'across') : []
      const wallHeight = pitched.length ? proposedWall : height
      if (pitched.length) roofIds.push(String(feature.id))
      tint.set(roofColor)
      if (pitched.length) {
        for (const [index, triangle] of pitched.entries()) {
          const shade = index % 2 ? .85 : 1
          for (const vertex of triangle) { roofPositions.push(...vertex); roofColors.push(tint.r * shade, tint.g * shade, tint.b * shade) }
        }
      } else {
        for (const triangle of ShapeUtils.triangulateShape(contour, holes)) {
          for (const vertex of triangle) {
            roofPositions.push(vertices[vertex].x, vertices[vertex].y, height + .025)
            roofColors.push(tint.r, tint.g, tint.b)
          }
        }
      }
      const taggedFloors = Number(properties['building:levels'])
      const floors = Math.min(80, taggedFloors > 0 && taggedFloors < 200 ? Math.round(taggedFloors) : Math.max(1, Math.floor(wallHeight / 3.2)))
      const floorHeight = wallHeight / floors
      for (let edge = 0; edge < points.length - 1 && boxes.length < budget; edge++) {
        const [ax, ay] = points[edge], [bx, by] = points[edge + 1]
        const length = Math.hypot(bx - ax, by - ay)
        if (length < 2 || length > 250) continue
        const angle = Math.atan2(by - ay, bx - ax)
        // Raised roofline/cornice and inset-looking windows are procedural geometry.
        boxes.push({ x: (ax + bx) / 2, y: (ay + by) / 2, z: wallHeight + .12, width: length, depth: .35, height: .24, angle, color: trimColor, window: false })
        const columns = Math.min(55, Math.floor(length / (glassFacade ? 2.5 : 3.4)))
        const floorStep = quality === 'smooth' && height > 100 ? 2 : 1
        for (let floor = 0; floor < floors && boxes.length < budget; floor += floorStep) {
          const z = (floor + .55) * floorHeight
          if (z < base + 1 || z > wallHeight - .8) continue
          for (let column = 0; column < columns && boxes.length < budget; column++) {
            const t = (column + .5) / columns
            const variation = (seed + edge * 31 + floor * 17 + column * 7) % 11
            tint.set(glassColor).multiplyScalar(.8 + variation * .045)
            const width = Math.min(glassFacade ? 2.2 : 1.5, length / columns * (glassFacade ? .85 : .55))
            const windowHeight = Math.min(glassFacade ? 2.7 : 1.8, floorHeight * (glassFacade ? .85 : .55))
            const x = ax + (bx - ax) * t, y = ay + (by - ay) * t
            boxes.push({ x, y, z, width, depth: .18, height: windowHeight, angle, color: '#' + tint.getHexString(), window: true, nightColor: variation < 3 ? ['#efd3a1', '#e3bd80', '#f4e5bd'][variation] : '#293d47' })
            // Sills add depth up close without introducing textures or extra draw calls.
            if (quality === 'detailed' && !glassFacade && boxes.length < budget) boxes.push({ x, y, z: z - windowHeight / 2 - .08, width: width + .2, depth: .32, height: .14, angle, color: trimColor, window: false })
          }
        }
      }
      added = true
    }
    if (added) buildings++
  }
  return { boxes, origin, buildings, roofPositions, roofColors, roofIds }
}

export function packFacades(plan: ReturnType<typeof planFacades>) {
  const matrices = new Float32Array(plan.boxes.length * 16)
  const dayColors = new Float32Array(plan.boxes.length * 3)
  const nightColors = new Float32Array(plan.boxes.length * 3)
  const tint = new Color()
  plan.boxes.forEach((box, i) => {
    const c = Math.cos(box.angle), s = Math.sin(box.angle)
    matrices.set([c * box.width, s * box.width, 0, 0, -s * box.depth, c * box.depth, 0, 0, 0, 0, box.height, 0, box.x, box.y, box.z, 1], i * 16)
    tint.set(box.color).toArray(dayColors, i * 3)
    tint.set(box.window ? box.nightColor || '#314958' : box.color).toArray(nightColors, i * 3)
  })
  return { matrices, dayColors, nightColors, positions: new Float32Array(plan.roofPositions), colors: new Float32Array(plan.roofColors), origin: plan.origin, buildings: plan.buildings, roofIds: plan.roofIds }
}

export type PackedFacades = ReturnType<typeof packFacades>
