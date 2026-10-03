import { type FormEvent, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, MotionConfig, useMotionValue, useSpring, useReducedMotion } from 'motion/react'
import { gsap } from 'gsap'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { ArrowUpRight, Crosshair, LoaderCircle, Moon, Sun, Compass, Radio, Search, Building2, RotateCw, Play, Pause, Layers3 } from 'lucide-react'
import './App.css'
import './LiquidGlass.css'
import { buildingColor, emptyBuildings, loadNearbyBuildings, tileBase, tileHeight, type BuildingData } from './buildings'
import type { FacadeLayer, FacadeMap, Quality } from './facades'

type Coordinates = [number, number]

type MapLibreMap = FacadeMap & {
  on: (event: string, callback: (event: { sourceId?: string }) => void) => MapLibreMap
  addControl: (control: unknown, position?: string) => MapLibreMap
  addSource: (id: string, source: { type: string; tiles?: string[]; tileSize?: number; maxzoom?: number; data?: BuildingData; attribution?: string }) => void
  addLayer: (layer: FacadeLayer | { id: string; type: string; source: string; 'source-layer'?: string; minzoom?: number; paint?: Record<string, unknown>; filter?: unknown[] }, beforeId?: string) => void
  getSource: (id: string) => { setData: (data: BuildingData) => void }
  setFilter: (id: string, filter: unknown[] | null) => void
  flyTo: (options: { center: Coordinates; zoom: number; duration?: number }) => void
  getCenter: () => { lng: number; lat: number }
  getBearing: () => number
  getZoom: () => number
  rotateTo: (bearing: number, options: { duration: number }) => void
  easeTo: (options: { pitch?: number; zoom?: number; duration: number }) => void
  moveLayer: (id: string, beforeId?: string) => void
  getStyle: () => { layers?: Array<{ id: string; type: string; layout?: Record<string, unknown> }> }
  setLayoutProperty: (layerId: string, property: string, value: unknown) => void
  setPaintProperty: (layerId: string, property: string, value: unknown) => void
  remove: () => void
}

type MapLibreApi = {
  Map: new (options: { container: HTMLElement; style: string; center: Coordinates; zoom: number; pitch?: number; bearing?: number; attributionControl?: boolean; pixelRatio?: number }) => MapLibreMap
  NavigationControl: new () => unknown
}

type SearchResult = { lat: string; lon: string; display_name: string }

const defaultLocation: Coordinates = [-74.006, 40.7128]
const destinations: { name: string; coordinates: Coordinates; tag: string }[] = [
  { name: 'Tokyo', coordinates: [139.6917, 35.6895], tag: '01' },
  { name: 'Paris', coordinates: [2.3522, 48.8566], tag: '02' },
  { name: 'Cairo', coordinates: [31.2357, 30.0444], tag: '03' },
  { name: 'London', coordinates: [-.0803, 51.5135], tag: '04' },
  { name: 'Dubai', coordinates: [55.2744, 25.1972], tag: '05' },
  { name: 'Mumbai', coordinates: [72.8347, 18.9402], tag: '06' },
]

function App() {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<MapLibreMap | null>(null)
  const [query, setQuery] = useState('')
  const [locationName, setLocationName] = useState('New York City')
  const [isSearching, setIsSearching] = useState(false)
  const [isNight, setIsNight] = useState(false)
  const [center, setCenter] = useState<Coordinates>(defaultLocation)
  const [isFlying, setIsFlying] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [ready, setReady] = useState(false)
  const [is3D, setIs3D] = useState(true)
  const [orbiting, setOrbiting] = useState(false)
  const [riseKey, setRiseKey] = useState(0)
  const [enriching, setEnriching] = useState(false)
  const [detailStatus, setDetailStatus] = useState('Global footprints · heights may be estimated')
  const detailRequest = useRef<AbortController | null>(null)
  const riseProgress = useRef(1)
  const facadeLayer = useRef<FacadeLayer | null>(null)
  const facadeDirty = useRef(true)
  const [quality, setQuality] = useState<Quality>('smooth')
  const [facadeStatus, setFacadeStatus] = useState('Zoom in for architectural detail')
  const facadeSettings = useRef({ enabled: true, night: false, quality: 'smooth' as Quality })
  const orbitActive = useRef(false)
  const panel = useRef<HTMLElement>(null)
  const reducedMotion = useReducedMotion()
  const [placeRef] = useAutoAnimate<HTMLDivElement>()
  const pointerX = useMotionValue(50)
  const pointerY = useMotionValue(50)
  const rotateX = useSpring(0, { stiffness: 180, damping: 25 })
  const rotateY = useSpring(0, { stiffness: 180, damping: 25 })
  const [message, setMessage] = useState('Drag to explore. Scroll or use + and - to zoom.')

  useEffect(() => {
    facadeSettings.current = { enabled: is3D, night: isNight, quality }
    facadeLayer.current?.configure(facadeSettings.current)
    facadeDirty.current = true
    mapInstance.current?.triggerRepaint()
  }, [is3D, isNight, quality])

  useEffect(() => {
    const map = mapInstance.current
    if (!map || !ready) return
    let cancelled = false
    // Three.js is loaded after the interactive map, not in the initial app bundle.
    import('./facades').then(({ createFacadeLayer }) => {
      if (cancelled || mapInstance.current !== map) return
      const layer = createFacadeLayer()
      const firstLabel = map.getStyle().layers?.find(item => item.type === 'symbol')?.id
      map.addLayer(layer, firstLabel)
      facadeLayer.current = layer
      layer.configure(facadeSettings.current)
      layer.setProgress(riseProgress.current)
      facadeDirty.current = true
      map.triggerRepaint()
    }).catch(() => setFacadeStatus('Architectural details unavailable; base buildings remain visible.'))
    return () => { cancelled = true }
  }, [ready])

  useEffect(() => {
    const map = mapInstance.current
    if (!map || !ready) return
    map.easeTo({ pitch: is3D ? 60 : 0, zoom: is3D ? Math.max(15.5, map.getZoom()) : map.getZoom(), duration: reducedMotion ? 0 : 1400 })
    const height = { value: is3D ? 0 : 1 }
    let lastUpdate = -Infinity
    const updateHeight = () => {
      const now = performance.now()
      if (height.value !== 0 && height.value !== 1 && now - lastUpdate < 33) return
      lastUpdate = now
      riseProgress.current = height.value
      facadeLayer.current?.setProgress(height.value)
      map.setPaintProperty('atlas-buildings', 'fill-extrusion-height', ['*', tileHeight, height.value])
      map.setPaintProperty('atlas-buildings', 'fill-extrusion-base', ['*', tileBase, height.value])
      map.setPaintProperty('building-details', 'fill-extrusion-height', ['*', facadeLayer.current?.detailHeight() || ['get', 'height'], height.value])
      map.setPaintProperty('building-details', 'fill-extrusion-base', ['*', ['get', 'base'], height.value])
    }
    updateHeight()
    const tween = gsap.to(height, { value: is3D ? 1 : 0, duration: reducedMotion ? 0 : 1.4, ease: 'power3.inOut', onUpdate: updateHeight, onComplete: updateHeight })
    return () => { tween.kill() }
  }, [is3D, ready, reducedMotion, riseKey])

  useEffect(() => {
    const map = mapInstance.current
    if (!map || !ready || !orbiting || !is3D || reducedMotion) return
    orbitActive.current = true
    const camera = { bearing: map.getBearing() }
    const tween = gsap.to(camera, { bearing: camera.bearing + 360, duration: 90, repeat: -1, ease: 'none', onUpdate: () => map.rotateTo(camera.bearing, { duration: 0 }) })
    const pause = () => setOrbiting(false)
    document.addEventListener('visibilitychange', pause)
    return () => { tween.kill(); orbitActive.current = false; document.removeEventListener('visibilitychange', pause) }
  }, [orbiting, is3D, ready, reducedMotion])

  useEffect(() => {
    if (reducedMotion) return
    const context = gsap.context(() => {
      gsap.fromTo('.reveal', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: .65, stagger: .075, delay: .2, ease: 'power3.out' })
      gsap.fromTo('.title-letter', { yPercent: 110, rotate: 8 }, { yPercent: 0, rotate: 0, duration: .85, stagger: .045, delay: .4, ease: 'expo.out' })
    }, panel)
    return () => context.revert()
  }, [reducedMotion])

  useEffect(() => {
    const maplibregl = (window as unknown as { maplibregl?: MapLibreApi }).maplibregl
    if (!maplibregl || !mapElement.current) return

    const map = new maplibregl.Map({
      container: mapElement.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: defaultLocation,
      zoom: 15.8,
      pitch: 60,
      bearing: -25,
      attributionControl: true,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.75),
    })
    map.on('load', () => {
      const firstLabelLayer = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
      map.addSource('esri-satellite', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
      })
      map.addLayer({
        id: 'esri-satellite-layer',
        type: 'raster',
        source: 'esri-satellite',
        paint: { 'raster-opacity': 1 },
      }, firstLabelLayer)
      map.addControl(new maplibregl.NavigationControl(), 'bottom-right')
      map.getStyle().layers?.filter((layer) => layer.type === 'symbol' && layer.layout?.['text-field']).forEach((layer) => {
        map.setLayoutProperty(layer.id, 'text-font', ['Noto Sans Bold'])
        map.setPaintProperty(layer.id, 'text-color', '#ffffff')
        map.setPaintProperty(layer.id, 'text-halo-color', '#0c1716')
        map.setPaintProperty(layer.id, 'text-halo-width', 2)
        map.setPaintProperty(layer.id, 'text-halo-blur', 0.15)
      })
      map.setLayoutProperty('building-3d', 'visibility', 'none')
      map.addLayer({ id: 'atlas-buildings', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
        filter: ['!=', ['to-string', ['get', 'hide_3d']], 'true'],
        paint: { 'fill-extrusion-color': buildingColor, 'fill-extrusion-opacity': 1, 'fill-extrusion-height': 0, 'fill-extrusion-base': 0, 'fill-extrusion-vertical-gradient': true },
      }, firstLabelLayer)
      map.addSource('building-details', { type: 'geojson', data: emptyBuildings, attribution: '© OpenStreetMap contributors' })
      map.addLayer({ id: 'building-details', type: 'fill-extrusion', source: 'building-details', minzoom: 13,
        paint: { 'fill-extrusion-color': ['get', 'facadeColor'], 'fill-extrusion-height': 0, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1 },
      }, firstLabelLayer)
      setReady(true)
    })
    mapInstance.current = map
    let detailTimer: ReturnType<typeof setTimeout> | undefined
    map.on('movestart', () => {
      if (!orbitActive.current) {
        clearTimeout(detailTimer)
        facadeLayer.current?.cancelPending()
        setIsFlying(true)
      }
    })
    map.on('moveend', () => {
      if (orbitActive.current) return
      const position = map.getCenter()
      facadeDirty.current = true
      setCenter([position.lng, position.lat])
      setIsFlying(false)
    })
    map.on('sourcedata', (event) => {
      if (event.sourceId === 'openmaptiles' || event.sourceId === 'building-details') facadeDirty.current = true
    })
    map.on('idle', () => {
      if (!facadeDirty.current || !facadeLayer.current || orbitActive.current) return
      facadeDirty.current = false
      clearTimeout(detailTimer)
      detailTimer = setTimeout(() => {
        facadeLayer.current?.refresh().then(count => {
          if (count === null || mapInstance.current !== map) return
          setFacadeStatus(count ? `${count} nearby facades · generated windows; mapped or estimated roofs` : 'Zoom in closer for architectural detail')
        }).catch(() => { if (mapInstance.current === map) setFacadeStatus('Architectural detail unavailable; base buildings remain visible.') })
      }, 180)
    })

    return () => {
      clearTimeout(detailTimer)
      detailRequest.current?.abort()
      map.remove()
      facadeLayer.current = null
      mapInstance.current = null
    }
  }, [])

  const enrichNearby = async () => {
    const map = mapInstance.current
    if (!map || enriching) return
    if (map.getZoom() < 15) { setDetailStatus('Zoom closer to enrich a neighborhood.'); return }
    const position = map.getCenter()
    const controller = new AbortController()
    detailRequest.current?.abort()
    detailRequest.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 25000)
    setEnriching(true)
    setDetailStatus('Loading nearby footprints and building parts…')
    try {
      const { data, region } = await loadNearbyBuildings(position.lng, position.lat, controller.signal)
      if (controller.signal.aborted || mapInstance.current !== map) return
      if (!data.features.length) { setDetailStatus('No extra mapped footprints here. Global buildings remain on.'); return }
      map.getSource('building-details').setData(data)
      // Replace only the loaded neighborhood, leaving global tiles everywhere else.
      map.setFilter('atlas-buildings', ['all', ['!=', ['to-string', ['get', 'hide_3d']], 'true'], ['!', ['within', region]]])
      map.setPaintProperty('building-details', 'fill-extrusion-height', ['*', ['get', 'height'], riseProgress.current])
      map.setPaintProperty('building-details', 'fill-extrusion-base', ['*', ['get', 'base'], riseProgress.current])
      const estimated = data.features.filter(feature => feature.properties?.heightSource !== 'tagged').length
      setDetailStatus(`Last enriched area: ${data.features.length.toLocaleString()} shapes · ${estimated.toLocaleString()} heights estimated`)
    } catch (error) {
      if (mapInstance.current === map) setDetailStatus(controller.signal.aborted ? 'Detail request timed out. Global buildings remain on.' : error instanceof Error ? error.message : 'Extra details unavailable. Global buildings remain on.')
    } finally {
      window.clearTimeout(timeout)
      if (mapInstance.current === map) setEnriching(false)
    }
  }

  const searchLocation = async (event: FormEvent) => {
    event.preventDefault()
    const searchTerm = query.trim()
    if (!searchTerm || !mapInstance.current) return

    setIsSearching(true)
    setOrbiting(false)
    setMessage('Finding that place...')
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(searchTerm)}`)
      if (!response.ok) throw new Error('Search failed')
      const results = await response.json() as SearchResult[]
      const result = results[0]
      if (!result) {
        setMessage('No location found. Try a city, landmark, or address.')
        return
      }

      const coordinates: Coordinates = [Number(result.lon), Number(result.lat)]
      mapInstance.current?.flyTo({ center: coordinates, zoom: is3D ? 16 : 14, duration: reducedMotion ? 0 : 2200 })
      setLocationName(result.display_name.split(',')[0])
      setMessage('Location found. Keep exploring.')
    } catch {
      setMessage('Could not search right now. Check your connection and try again.')
    } finally {
      setIsSearching(false)
    }
  }

  const findMe = () => {
    if (!navigator.geolocation || !mapInstance.current) {
      setMessage('Location access is not available in this browser.')
      return
    }

    setMessage('Requesting your location...')
    setOrbiting(false)
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinates: Coordinates = [coords.longitude, coords.latitude]
        setIsLocating(false)
        mapInstance.current?.flyTo({ center: coordinates, zoom: is3D ? 16 : 14, duration: reducedMotion ? 0 : 2200 })
        setLocationName('Your location')
        setMessage('You are here. Keep exploring.')
      },
      () => { setIsLocating(false); setMessage('Location access was unavailable. You can still search above.') },
      { timeout: 15000 },
    )
  }

  return (
    <MotionConfig reducedMotion="user"><main className={`map-app ${isNight ? 'night' : ''} ${isFlying ? 'in-flight' : ''}`}>
      <section className="map-panel">
        <div ref={mapElement} className="map" aria-label="Interactive world map" onPointerDown={() => setOrbiting(false)} onWheel={() => setOrbiting(false)} onKeyDown={() => setOrbiting(false)} />
        <div className="map-overlay map-branding"><span className="brand-dot" /><span>Atlas</span><span className="brand-ping" /></div>
        <div className="map-overlay map-help" role="status"><AnimatePresence mode="wait"><motion.span key={message} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>{message}</motion.span></AnimatePresence></div>
        <div className="map-readout map-overlay"><span>{Math.abs(center[1]).toFixed(4)}&deg; {center[1] >= 0 ? 'N' : 'S'}</span><span>{Math.abs(center[0]).toFixed(4)}&deg; {center[0] >= 0 ? 'E' : 'W'}</span><i /></div>
        <AnimatePresence>{isFlying && <motion.div className="flight-indicator map-overlay" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}><Compass size={14} className="spin" /> Exploring the world</motion.div>}</AnimatePresence>
      </section>
      <motion.aside ref={panel} className="control-panel" style={{ rotateX, rotateY, transformPerspective: 1100 }} onPointerMove={(event) => {
        if (reducedMotion || event.pointerType !== 'mouse') return
        const box = event.currentTarget.getBoundingClientRect()
        const x = (event.clientX - box.left) / box.width
        const y = (event.clientY - box.top) / box.height
        pointerX.set(x * 100); pointerY.set(y * 100)
        event.currentTarget.style.setProperty('--pointer-x', pointerX.get() + '%')
        event.currentTarget.style.setProperty('--pointer-y', pointerY.get() + '%')
        rotateX.set((.5 - y) * 4); rotateY.set((x - .5) * 4)
      }} onPointerLeave={() => { rotateX.set(0); rotateY.set(0) }}>
        <div className="panel-shine" aria-hidden="true" />
        <div className="control-header reveal"><span className="eyebrow"><Radio size={12} /> Satellite</span><motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: .92 }} className="night-toggle" type="button" onClick={() => setIsNight((value) => !value)} aria-label="Toggle night mode" aria-pressed={isNight}><AnimatePresence mode="wait"><motion.span key={String(isNight)} initial={{ rotate: -80, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 80, opacity: 0 }}>{isNight ? <Sun size={14} /> : <Moon size={14} />}</motion.span></AnimatePresence>{isNight ? 'Day' : 'Night'}</motion.button></div>
        <div className="globe-3d" aria-hidden="true"><div className="globe-sphere"><span /></div><i className="globe-orbit orbit-one" /><i className="globe-orbit orbit-two" /><b>3D</b></div>
        <div className="intro-label reveal">A different point of view</div>
        <div className="city-controls reveal">
          <div className="city-mode-label"><Building2 size={15} /><span>{is3D ? 'Worldwide 3D buildings' : 'Satellite overview'}</span></div>
          <div className="city-actions">
            <motion.button whileTap={{ scale: .94 }} disabled={!ready} aria-pressed={is3D} onClick={() => { setOrbiting(false); setIs3D(!is3D) }}><Layers3 size={14} />{is3D ? '3D on' : '2D view'}</motion.button>
            <motion.button whileTap={{ scale: .94 }} disabled={!ready || !is3D || !!reducedMotion} aria-pressed={orbiting} onClick={() => { setIsFlying(false); setOrbiting(!orbiting) }}>{orbiting ? <Pause size={14} /> : <Play size={14} />}{orbiting ? 'Pause' : 'Orbit'}</motion.button>
            <motion.button whileTap={{ scale: .94 }} disabled={!ready || !is3D || !!reducedMotion} onClick={() => { setOrbiting(false); setRiseKey(value => value + 1) }}><RotateCw size={14} />Rise</motion.button>
          </div>
          <span className="city-caption">{reducedMotion ? 'Motion reduced by your device settings.' : orbiting ? 'Orbiting · touch the map to take control' : 'Tilt, orbit, and watch the skyline rise.'}</span>
          <button className="enrich-button" onClick={enrichNearby} disabled={!ready || !is3D || enriching}>{enriching ? <LoaderCircle size={14} className="spin" /> : <Building2 size={14} />} {enriching ? 'Loading buildings' : 'Enrich nearby buildings'}</button>
          <span className="city-caption" role="status">{detailStatus}</span>
          <div className="quality-control" role="group" aria-label="Rendering quality">
            <button aria-pressed={quality === 'smooth'} onClick={() => setQuality('smooth')}>Smooth</button>
            <button aria-pressed={quality === 'detailed'} onClick={() => setQuality('detailed')}>Detailed</button>
          </div>
          <span className="city-caption" role="status">{facadeStatus}</span>
        </div>
        <h1 aria-label="Explore.">{'Explore.'.split('').map((letter, index) => <span className="title-letter" aria-hidden="true" key={index}>{letter}</span>)}</h1>
        <form className="search-form reveal" onSubmit={searchLocation}>
          <label htmlFor="location-search">Where to next?</label>
          <div className="search-row">
            <Search size={15} className="search-icon" aria-hidden="true" /><input id="location-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="City, landmark, or address" />
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: .88 }} type="submit" disabled={isSearching || !ready || !query.trim()} aria-label="Search map">{isSearching ? <LoaderCircle size={16} className="spin" /> : <ArrowUpRight size={18} />}</motion.button>
          </div>
        </form>
        <motion.button whileHover={{ x: 4 }} whileTap={{ scale: .96 }} className="location-button reveal" type="button" onClick={findMe} disabled={isLocating || !ready}>{isLocating ? <LoaderCircle size={17} className="spin" /> : <Crosshair size={17} />} {isLocating ? 'Locating you...' : 'Locate me'}</motion.button>
        <div className="destinations reveal"><span className="eyebrow">Take a little detour</span><div className="destination-list">{destinations.map((place) => <motion.button key={place.name} type="button" disabled={!ready || isSearching} whileHover={{ y: -3 }} whileTap={{ scale: .94 }} onClick={() => {
          setOrbiting(false)
          mapInstance.current?.flyTo({ center: place.coordinates, zoom: is3D ? 16 : 13, duration: reducedMotion ? 0 : 2800 })
          setLocationName(place.name); setMessage('Exploring ' + place.name + '. Make yourself at home.')
        }}><span>{place.tag}</span>{place.name}<ArrowUpRight size={12} /></motion.button>)}</div></div>
        <div className="current-place reveal" ref={placeRef}><span className="eyebrow">Viewing</span><strong key={locationName}>{locationName}</strong><span className="coordinates">{isFlying ? 'Moving across the map' : 'Satellite imagery'}</span></div>
        <footer>Imagery © Esri · Buildings <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a> / <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a></footer>
      </motion.aside>
    </main></MotionConfig>
  )
}

export default App

