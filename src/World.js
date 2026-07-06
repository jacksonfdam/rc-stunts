import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import levelUrl from './assets/rc-level.glb?url'

const ENVIRONMENT_SCALE = 3
export const DEFAULT_ENVIRONMENT_PARAMS = {
  offsetY: 2,
}

/**
 * Scene environment: visible level GLB plus static collision generated from it.
 */
export class World {
  constructor(scene, physicsWorld, reflectionMap = null) {
    this.scene = scene
    this.physicsWorld = physicsWorld
    this.reflectionMap = reflectionMap

    // Static GLB environment only. This stays empty unless future dynamic
    // bodies need their meshes synced every frame.
    this.dynamicPairs = []
    this.environmentParams = { ...DEFAULT_ENVIRONMENT_PARAMS }

    this._createLights()
    this.ready = this._loadEnvironment()
  }

  _createLights() {
    const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a4a3a, 2)
    this.scene.add(hemi)
    this.hemi = hemi

    const sun = new THREE.DirectionalLight(0xfff2d9, 2.52)
    sun.position.set(25, 40, 8)
    sun.castShadow = true
    // Mobile GPUs get a lighter shadow map; desktop gets the crisp one
    const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
    const shadowMapSize = isCoarsePointer ? 2048 : 4096
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    sun.shadow.camera.left = -60
    sun.shadow.camera.right = 60
    sun.shadow.camera.top = 60
    sun.shadow.camera.bottom = -60
    sun.shadow.camera.far = 150
    sun.shadow.bias = -0.0001
    // Pushes shadow sampling slightly along surface normals: cleans up
    // self-shadowing acne on the level's ramps and curved surfaces.
    sun.shadow.normalBias = 0.02
    // Big radius = soft PCF penumbra (per mrdoob: "big shadow radius + GTAO")
    sun.shadow.radius = 3
    this.scene.add(sun)
    this.sun = sun
  }

  async _loadEnvironment() {
    const loader = new GLTFLoader()
    await Promise.all([
      this._loadHouse(loader),
      this._loadCollider(loader),
    ])
  }

  async _loadHouse(loader) {
    try {
      const gltf = await loader.loadAsync(levelUrl)
      gltf.scene.scale.setScalar(ENVIRONMENT_SCALE)
      let hasMesh = false

      gltf.scene.traverse((child) => {
        if (!child.isMesh) return
        hasMesh = true
        child.castShadow = true
        child.receiveShadow = true
        this._applyHouseReflection(child)
      })

      if (!hasMesh) {
        console.warn('rc-level.glb contains no meshes')
        return
      }

      this.scene.add(gltf.scene)
      this.house = gltf.scene
      this.applyEnvironmentParams()
    } catch (error) {
      console.warn('Could not load rc-level.glb', error)
    }
  }

  async _loadCollider(loader) {
    try {
      const gltf = await loader.loadAsync(levelUrl)
      gltf.scene.scale.setScalar(ENVIRONMENT_SCALE)
      const body = new CANNON.Body({
        mass: 0,
        material: this.physicsWorld.defaultMaterial,
      })
      let shapeCount = 0

      gltf.scene.updateMatrixWorld(true)
      gltf.scene.traverse((child) => {
        if (!child.isMesh || !child.geometry?.attributes?.position) return
        shapeCount += this._addTrimeshColliderShape(body, child)
      })

      if (shapeCount === 0) {
        console.warn('rc-level.glb contains no mesh collider geometry')
        return
      }

      // Cannon caches broadphase bounds, so refresh them after adding static shapes.
      body.updateAABB()
      this.physicsWorld.addBody(body)
      this.colliderBody = body
      this.applyEnvironmentParams()
    } catch (error) {
      console.warn('Could not load rc-level.glb collider', error)
    }
  }

  applyEnvironmentParams() {
    const { offsetY } = this.environmentParams

    if (this.house) this.house.position.y = offsetY
    if (this.colliderBody) {
      this.colliderBody.position.y = offsetY
      this.colliderBody.updateAABB()
    }
  }

  _applyHouseReflection(mesh) {
    if (!this.reflectionMap) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material) continue
      const name = `${mesh.name} ${material.name}`.toLowerCase()
      const looksLikeGlass =
        name.includes('glass') ||
        name.includes('window') ||
        material.transparent ||
        material.opacity < 1 ||
        material.transmission > 0

      if (!looksLikeGlass) continue
      material.envMap = this.reflectionMap
      material.envMapIntensity = 0.75
      material.roughness = Math.min(material.roughness ?? 0.2, 0.18)
      material.metalness = Math.max(material.metalness ?? 0, 0.08)
      material.needsUpdate = true
    }
  }

  /**
   * Builds an exact CANNON.Trimesh from a mesh's triangles (in world space,
   * so the GLB scale/rotation is baked in). This follows the real geometry
   * including concave shapes and ramps.
   *
   * Caveats of trimesh in cannon-es:
   * - It only generates contacts against spheres and planes, so the car's
   *   chassis carries small corner spheres (see Vehicle._createPhysics).
   * - Wheel raycasts work against it natively, which is what actually
   *   drives the vehicle on ramps.
   * - Indices are stored as Int16, so any single mesh above ~32k vertices
   *   is skipped rather than silently corrupted.
   */
  _addTrimeshColliderShape(body, mesh) {
    const position = mesh.geometry?.attributes?.position
    if (!position || position.count < 3) return 0
    if (position.count > 32767) {
      console.warn(`Mesh "${mesh.name}" has too many vertices for a cannon-es Trimesh — skipped`)
      return 0
    }

    const vertices = new Array(position.count * 3)
    const vertex = new THREE.Vector3()
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
      vertices[i * 3] = vertex.x
      vertices[i * 3 + 1] = vertex.y
      vertices[i * 3 + 2] = vertex.z
    }

    const indices = mesh.geometry.index
      ? Array.from(mesh.geometry.index.array)
      : Array.from({ length: position.count }, (_, i) => i)

    body.addShape(new CANNON.Trimesh(vertices, indices))
    return 1
  }

  update() {
    for (const { body, mesh } of this.dynamicPairs) {
      mesh.position.copy(body.position)
      mesh.quaternion.copy(body.quaternion)
    }
  }
}
