import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CharacterModPackage, CharacterMotion } from '../../characters/types'
import { loadCharacterModAssetBytes, releaseCharacterModAssetBytes } from '../../lib/characterMods'

interface GltfModMascotProps {
  characterPackage: CharacterModPackage
  motion: CharacterMotion
  size: number
  spinSignal: number
  className?: string
  fallback: ReactNode
}

const gltfLoadQueue: Array<() => Promise<void>> = []
let activeGltfLoads = 0
const MAX_CONCURRENT_GLTF_LOADS = 2

function pumpGltfLoadQueue() {
  while (activeGltfLoads < MAX_CONCURRENT_GLTF_LOADS && gltfLoadQueue.length > 0) {
    activeGltfLoads += 1
    const run = gltfLoadQueue.shift()
    void run?.().finally(() => {
      activeGltfLoads -= 1
      pumpGltfLoadQueue()
    })
  }
}

function scheduleGltfLoad<T>(load: () => Promise<T>, isStale: () => boolean) {
  return new Promise<T | null>((resolve, reject) => {
    gltfLoadQueue.push(async () => {
      if (isStale()) {
        resolve(null)
        return
      }
      try {
        resolve(await load())
      } catch (error) {
        reject(error)
      }
    })
    pumpGltfLoadQueue()
  })
}

function disposeThreeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  const skeletons = new Set<THREE.Skeleton>()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton)
    geometries.add(object.geometry)
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material]
    meshMaterials.forEach((material) => {
      materials.add(material)
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value)
      })
    })
  })
  textures.forEach((texture) => {
    texture.dispose()
    const image = texture.source.data as { close?: () => void } | null
    image?.close?.()
  })
  materials.forEach((material) => material.dispose())
  geometries.forEach((geometry) => geometry.dispose())
  skeletons.forEach((skeleton) => skeleton.dispose())
}

export function GltfModMascot({
  characterPackage,
  motion,
  size,
  spinSignal,
  className = '',
  fallback,
}: GltfModMascotProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const clipsRef = useRef<THREE.AnimationClip[]>([])
  const activeActionRef = useRef<THREE.AnimationAction | null>(null)
  const spinSignalRef = useRef(spinSignal)
  const [readyVersion, setReadyVersion] = useState(0)
  const [failed, setFailed] = useState(false)
  const manifest = characterPackage.manifest
  spinSignalRef.current = spinSignal

  useEffect(() => {
    setFailed(false)
  }, [characterPackage.revision])

  useEffect(() => {
    const host = hostRef.current
    if (!host || failed || manifest.renderer !== 'gltf-3d') return
    const source = manifest.source
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
    camera.position.set(0, 0.15, 5.4)
    camera.lookAt(0, 0, 0)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      setFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(size, size, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    renderer.shadowMap.enabled = true
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    host.replaceChildren(renderer.domElement)

    scene.add(new THREE.HemisphereLight('#fff8f1', '#756d88', 2.25))
    const keyLight = new THREE.DirectionalLight('#fff1df', 4.1)
    keyLight.position.set(-3.5, 5, 5)
    keyLight.castShadow = true
    scene.add(keyLight)
    const fillLight = new THREE.PointLight('#ffc5d7', 8, 12)
    fillLight.position.set(3.5, 1.5, 3)
    scene.add(fillLight)
    const rimLight = new THREE.PointLight('#bdeeff', 7, 10)
    rimLight.position.set(-3, 1, -2)
    scene.add(rimLight)

    const spinRoot = new THREE.Group()
    scene.add(spinRoot)
    let loadedRoot: THREE.Object3D | null = null
    let disposed = false
    let observedSpinSignal = spinSignalRef.current
    let spinStartedAt = -1
    const clock = new THREE.Clock()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    scheduleGltfLoad(async () => {
      if (disposed) return null
      const bytes = await loadCharacterModAssetBytes(characterPackage, 'model')
      if (disposed) return null
      return new GLTFLoader().parseAsync(bytes.slice().buffer, '')
    }, () => disposed)
      .then((gltf) => {
        if (!gltf) return
        if (disposed) {
          disposeThreeObject(gltf.scene)
          return
        }
        loadedRoot = gltf.scene
        loadedRoot.rotation.y = THREE.MathUtils.degToRad(source.rotationY ?? 0)
        spinRoot.add(loadedRoot)

        const initialBounds = new THREE.Box3().setFromObject(loadedRoot)
        if (initialBounds.isEmpty()) throw new Error('GLB scene has no visible bounds')
        const dimensions = initialBounds.getSize(new THREE.Vector3())
        if (![dimensions.x, dimensions.y, dimensions.z].every(Number.isFinite)) {
          throw new Error('GLB scene bounds are not finite')
        }
        const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z, 0.001)
        loadedRoot.scale.multiplyScalar((2.35 / maxDimension) * (source.scale ?? 1))
        const bounds = new THREE.Box3().setFromObject(loadedRoot)
        const center = bounds.getCenter(new THREE.Vector3())
        if (bounds.isEmpty() || ![center.x, center.y, center.z].every(Number.isFinite)) {
          throw new Error('GLB normalized bounds are invalid')
        }
        loadedRoot.position.x -= center.x
        loadedRoot.position.y -= center.y - (source.groundOffset ?? 0)
        loadedRoot.position.z -= center.z
        loadedRoot.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          object.castShadow = true
          object.receiveShadow = true
        })

        const groundedBounds = new THREE.Box3().setFromObject(loadedRoot)
        const shadow = new THREE.Mesh(
          new THREE.CircleGeometry(0.82, 40),
          new THREE.ShadowMaterial({ color: '#5e4650', opacity: 0.18 })
        )
        shadow.rotation.x = -Math.PI / 2
        shadow.position.y = groundedBounds.min.y - 0.02
        shadow.receiveShadow = true
        scene.add(shadow)

        mixerRef.current = new THREE.AnimationMixer(loadedRoot)
        clipsRef.current = gltf.animations
        setReadyVersion((value) => value + 1)
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
      .finally(() => releaseCharacterModAssetBytes(characterPackage, 'model'))

    let frame = 0
    const startedAt = performance.now()
    const render = (timestamp: number) => {
      const delta = Math.min(clock.getDelta(), 0.05)
      if (!reducedMotion.matches) mixerRef.current?.update(delta)
      const elapsed = (timestamp - startedAt) / 1000
      if (spinSignalRef.current !== observedSpinSignal) {
        observedSpinSignal = spinSignalRef.current
        spinStartedAt = reducedMotion.matches ? -1 : elapsed
      }
      const float = reducedMotion.matches ? 0 : Math.sin(elapsed * 2.05) * 0.035
      spinRoot.position.y = float
      if (spinStartedAt >= 0) {
        const progress = Math.min(1, (elapsed - spinStartedAt) / 0.9)
        spinRoot.rotation.y = (1 - Math.pow(1 - progress, 3)) * Math.PI * 2
        if (progress >= 1) {
          spinStartedAt = -1
          spinRoot.rotation.y = 0
        }
      }
      renderer.render(scene, camera)
      frame = window.requestAnimationFrame(render)
    }
    frame = window.requestAnimationFrame(render)

    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      activeActionRef.current?.stop()
      activeActionRef.current = null
      if (loadedRoot && mixerRef.current) {
        mixerRef.current.stopAllAction()
        mixerRef.current.uncacheRoot(loadedRoot)
      }
      mixerRef.current = null
      clipsRef.current = []
      disposeThreeObject(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement)
    }
  }, [characterPackage, failed, manifest, size])

  useEffect(() => {
    if (manifest.renderer !== 'gltf-3d' || !mixerRef.current) return
    const motionConfig = manifest.source.motions[motion]
      ?? manifest.source.motions.idle
      ?? Object.values(manifest.source.motions)[0]
    const clip = motionConfig
      ? THREE.AnimationClip.findByName(clipsRef.current, motionConfig.clip)
      : null
    if (!clip) {
      activeActionRef.current?.fadeOut(0.16)
      activeActionRef.current = null
      return
    }
    const action = mixerRef.current.clipAction(clip)
    action.reset()
    action.setLoop(motionConfig?.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = motionConfig?.loop === false
    activeActionRef.current?.fadeOut(0.16)
    action.fadeIn(0.16).play()
    activeActionRef.current = action
  }, [manifest, motion, readyVersion])

  if (failed) return <>{fallback}</>
  return (
    <div
      ref={hostRef}
      className={`mascot-webgl relative shrink-0 ${className}`}
      style={{ width: size, height: size }}
      data-character-renderer="gltf-3d"
      data-character-mod={manifest.id}
    />
  )
}
