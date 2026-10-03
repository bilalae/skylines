import { BoxGeometry, BufferGeometry, Camera, DoubleSide, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Scene, Vector3, WebGLRenderer } from 'three'
import type { FacadeMap, PackedFacades, Quality } from './facadeGeometry'
export { mercator, planFacades } from './facadeGeometry'
export type { FacadeMap, Quality } from './facadeGeometry'

export function createFacadeLayer() {
  const scene = new Scene()
  const camera = new Camera()
  const geometry = new BoxGeometry(1, 1, 1)
  const material = new MeshBasicMaterial({ color: '#ffffff' })
  const roofMaterial = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide })
  let mesh: InstancedMesh | undefined
  let roof: Mesh | undefined
  let renderer: WebGLRenderer | undefined
  let map: FacadeMap
  let worker: Worker | undefined
  let transform = new Matrix4()
  let dayColors: Float32Array | undefined
  let nightColors: Float32Array | undefined
  let enabled = true
  let night = false
  let quality: Quality = 'smooth'
  let progress = 1
  let roofIds: string[] = []
  let revision = 0
  let pending: { id: number; resolve: (value: number | null) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined
  const detailHeight = (): unknown[] => enabled && roofIds.length && map.getZoom() >= 15.8
    ? ['case', ['in', ['to-string', ['id']], ['literal', roofIds]], ['get', 'wallHeight'], ['get', 'height']]
    : ['get', 'height']
  const syncWalls = () => map.setPaintProperty('building-details', 'fill-extrusion-height', ['*', detailHeight(), progress])
  const clearPending = () => {
    if (pending) { clearTimeout(pending.timer); pending.resolve(null); pending = undefined }
  }
  const apply = (plan: PackedFacades) => {
    if (mesh) { scene.remove(mesh); mesh.dispose() }
    if (roof) { scene.remove(roof); roof.geometry.dispose() }
    const roofGeometry = new BufferGeometry()
    roofGeometry.setAttribute('position', new Float32BufferAttribute(plan.positions, 3))
    roofGeometry.setAttribute('color', new Float32BufferAttribute(plan.colors, 3))
    roof = new Mesh(roofGeometry, roofMaterial)
    roof.frustumCulled = false
    scene.add(roof)
    const count = plan.matrices.length / 16
    mesh = new InstancedMesh(geometry, material, Math.max(1, count))
    mesh.count = count
    mesh.frustumCulled = false
    mesh.instanceMatrix = new InstancedBufferAttribute(plan.matrices, 16)
    dayColors = plan.dayColors
    nightColors = plan.nightColors
    mesh.instanceColor = new InstancedBufferAttribute((night ? nightColors : dayColors).slice(), 3)
    scene.add(mesh)
    roofIds = plan.roofIds
    transform = new Matrix4().makeTranslation(plan.origin.x, plan.origin.y, 0).scale(new Vector3(plan.origin.scale, -plan.origin.scale, plan.origin.scale))
    syncWalls()
    map.triggerRepaint()
  }
  return {
    id: 'architectural-details', type: 'custom' as const, renderingMode: '3d' as const,
    onAdd(instance: FacadeMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      map = instance
      renderer = new WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: false })
      renderer.autoClear = false
      worker = new Worker(new URL('./facades.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: PackedFacades; error?: string }>) => {
        if (!pending || data.id !== pending.id) return
        const request = pending
        clearTimeout(request.timer)
        pending = undefined
        if (data.error || !data.result) { request.reject(new Error(data.error || 'No geometry returned')); return }
        try { apply(data.result); request.resolve(data.result.buildings) } catch { request.reject(new Error('Could not display architectural detail.')) }
      }
      worker.onerror = () => {
        if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Background geometry processor unavailable.')); pending = undefined }
      }
    },
    refresh(): Promise<number | null> {
      clearPending()
      if (!renderer || !enabled || map.getZoom() < 15.8 || !worker) { syncWalls(); return Promise.resolve(0) }
      const center = map.getCenter()
      const features = map.queryRenderedFeatures({ layers: ['atlas-buildings', 'building-details'] }).slice(0, 2500).map(feature => ({
        type: 'Feature' as const, id: feature.id, geometry: feature.geometry, properties: feature.properties,
      }))
      const id = ++revision
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { if (pending?.id === id) { pending = undefined; reject(new Error('Architectural detail generation timed out.')) } }, 15000)
        pending = { id, resolve, reject, timer }
        worker!.postMessage({ id, features, lng: center.lng, lat: center.lat, quality })
      })
    },
    configure(options: { enabled: boolean; night: boolean; quality: Quality }) {
      if (options.enabled !== enabled || options.quality !== quality) clearPending()
      enabled = options.enabled; night = options.night; quality = options.quality
      if (mesh?.instanceColor && dayColors && nightColors) {
        mesh.instanceColor.array.set(night ? nightColors : dayColors)
        mesh.instanceColor.needsUpdate = true
      }
      if (map) { syncWalls(); map.triggerRepaint() }
    },
    detailHeight,
    cancelPending: clearPending,
    setProgress(value: number) { progress = value },
    render(_gl: WebGLRenderingContext, matrix: number[]) {
      if (!enabled || !renderer || !mesh || map.getZoom() < 15.8 || progress <= 0) return
      scene.scale.z = progress
      camera.projectionMatrix.fromArray(matrix).multiply(transform)
      renderer.resetState()
      renderer.render(scene, camera)
      renderer.resetState()
    },
    onRemove() {
      clearPending(); worker?.terminate(); mesh?.dispose(); roof?.geometry.dispose()
      roofMaterial.dispose(); geometry.dispose(); material.dispose(); renderer?.dispose(); scene.clear()
    },
  }
}
export type FacadeLayer = ReturnType<typeof createFacadeLayer>
