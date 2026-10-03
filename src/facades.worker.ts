import { packFacades, planFacades, type Footprint, type Quality } from './facadeGeometry'

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; features: Footprint[]; lng: number; lat: number; quality: Quality }>) => void
  postMessage: (value: unknown, transfer?: Transferable[]) => void
}
scope.onmessage = ({ data }) => {
  try {
    const result = packFacades(planFacades(data.features, data.lng, data.lat, data.quality))
    scope.postMessage({ id: data.id, result }, [result.matrices.buffer, result.dayColors.buffer, result.nightColors.buffer, result.positions.buffer, result.colors.buffer])
  } catch {
    scope.postMessage({ id: data.id, error: 'Could not generate architectural detail.' })
  }
}
