import * as THREE from 'three'
import * as CANNON from 'cannon-es'

import { GRID } from './TrackFile.js'
import { describeElement, CATEGORY } from './trackElements.js'

/**
 * Builds a drivable scene from a parsed Stunts `TrackFile`: a ground plane and
 * one procedural piece per non-empty track tile, each with a matching static
 * collider. Mirrors World.js (visual mesh + physics collider from the same
 * source data) but generates geometry from the 30×30 grid instead of a GLB.
 *
 * Geometry is category-driven (see trackElements.js): flat roads/corners,
 * inclined ramps, raised elevated roads on pillars, loops/pipes as curved
 * visuals over a drivable flat base, scenery as non-colliding props, and
 * buildings as solid box obstacles. Flat pieces use CANNON.Box colliders (which
 * collide cleanly with the vehicle's box chassis); curved show-pieces (loop,
 * pipe, tunnel) keep only their flat base collider for now — driving up a true
 * loop needs tuned trimesh physics, a later step.
 */

// World units per grid tile. Real Stunts tiles are ~62.5 m; we use a smaller,
// gameplay-tuned size so the existing ~4 m car feels right on the road.
export const TILE = 24
const GROUND_Y = 0
const ROAD_H = 0.5 // flat slab thickness
const ELEV_H = 6 // height of raised/elevated pieces
const RAMP_RISE = ELEV_H // vertical rise across one ramp tile
const INSET = 0.94 // shrink tiles slightly so seams read as a grid

export class StuntsTrack {
  constructor(scene, physicsWorld, trackFile) {
    this.scene = scene
    this.physicsWorld = physicsWorld
    this.trackFile = trackFile

    this.group = new THREE.Group()
    this.scene.add(this.group)
    this.colliderBodies = []
    this._materials = new Map()

    // Centre the grid on the origin so (0,0) tile sits at -halfExtent.
    this.origin = -((GRID - 1) * TILE) / 2

    this._buildGround()
    this._buildTiles()
    this.start = this._findStart()
  }

  /** World-space centre of grid tile (x, y). y counts from the bottom row. */
  tileToWorld(x, y, out = new THREE.Vector3()) {
    return out.set(this.origin + x * TILE, GROUND_Y, this.origin + y * TILE)
  }

  _material(color, opts = {}) {
    const key = `${color}:${opts.roughness ?? 0.75}:${opts.metalness ?? 0.05}`
    let m = this._materials.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.75,
        metalness: opts.metalness ?? 0.05,
      })
      this._materials.set(key, m)
    }
    return m
  }

  _buildGround() {
    const span = GRID * TILE
    const geometry = new THREE.PlaneGeometry(span, span)
    geometry.rotateX(-Math.PI / 2)
    const material = new THREE.MeshStandardMaterial({ color: 0x4b5d2f, roughness: 1 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.y = GROUND_Y - 0.05
    mesh.receiveShadow = true
    this.group.add(mesh)

    // Static ground plane collider. A rotated CANNON.Plane fails vehicle
    // raycasts, so use a thick box just below the surface instead.
    const body = new CANNON.Body({ mass: 0, material: this.physicsWorld.defaultMaterial })
    body.addShape(new CANNON.Box(new CANNON.Vec3(span / 2, 5, span / 2)))
    body.position.set(0, GROUND_Y - 5, 0)
    body.updateAABB()
    this.physicsWorld.addBody(body)
    this.colliderBodies.push(body)
  }

  _buildTiles() {
    const center = new THREE.Vector3()
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const el = describeElement(this.trackFile.trackAt(x, y))
        if (el.empty) continue
        this.tileToWorld(x, y, center)
        this._buildPiece(el, center)
      }
    }
  }

  _buildPiece(el, center) {
    switch (el.category) {
      case CATEGORY.RAMP:
        this._addRamp(el, center)
        break
      case CATEGORY.ELEVATED:
      case CATEGORY.ELEVATED_CORNER:
      case CATEGORY.HIGHWAY:
      case CATEGORY.CORKSCREW:
        this._addElevated(el, center)
        break
      case CATEGORY.LOOP:
        this._addFlat(el, center)
        this._addLoopVisual(el, center)
        break
      case CATEGORY.PIPE:
      case CATEGORY.TUNNEL:
        this._addFlat(el, center)
        this._addTubeVisual(el, center)
        break
      case CATEGORY.SCENERY:
        this._addScenery(el, center)
        break
      case CATEGORY.BUILDING:
        this._addBuilding(el, center)
        break
      default: // ROAD, CORNER, JUNCTION, CHICANE, BANKED, START, FILLER
        this._addFlat(el, center)
    }
  }

  /** Yaw (about Y) for a piece's orientation index. */
  _yaw(orient) {
    return orient * (Math.PI / 2)
  }

  _addFlat(el, center) {
    const w = TILE * INSET
    const geometry = new THREE.BoxGeometry(w, ROAD_H, w)
    const mesh = new THREE.Mesh(geometry, this._material(el.color))
    mesh.position.set(center.x, GROUND_Y + ROAD_H / 2, center.z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    this._addBoxCollider(mesh.position, new CANNON.Vec3(w / 2, ROAD_H / 2, w / 2))
  }

  _addRamp(el, center) {
    const w = TILE * INSET
    const len = TILE * INSET
    const pitch = Math.atan2(RAMP_RISE, TILE)
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), this._yaw(el.orient))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch))

    const geometry = new THREE.BoxGeometry(w, ROAD_H, len)
    const mesh = new THREE.Mesh(geometry, this._material(el.color))
    mesh.position.set(center.x, GROUND_Y + RAMP_RISE / 2, center.z)
    mesh.quaternion.copy(q)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)

    const body = new CANNON.Body({ mass: 0, material: this.physicsWorld.defaultMaterial })
    body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, ROAD_H / 2, len / 2)))
    body.position.set(mesh.position.x, mesh.position.y, mesh.position.z)
    body.quaternion.set(q.x, q.y, q.z, q.w)
    body.updateAABB()
    this.physicsWorld.addBody(body)
    this.colliderBodies.push(body)
  }

  _addElevated(el, center) {
    const w = TILE * INSET
    const top = GROUND_Y + ELEV_H

    const geometry = new THREE.BoxGeometry(w, ROAD_H, w)
    const mesh = new THREE.Mesh(geometry, this._material(el.color))
    mesh.position.set(center.x, top + ROAD_H / 2, center.z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    this._addBoxCollider(mesh.position, new CANNON.Vec3(w / 2, ROAD_H / 2, w / 2))

    // Visual-only support pillar down to the ground.
    const pillarGeo = new THREE.BoxGeometry(TILE * 0.25, ELEV_H, TILE * 0.25)
    const pillar = new THREE.Mesh(pillarGeo, this._material(0x3a3f47))
    pillar.position.set(center.x, GROUND_Y + ELEV_H / 2, center.z)
    pillar.castShadow = true
    this.group.add(pillar)
  }

  _addLoopVisual(el, center) {
    // A vertical torus standing above the drivable base — a recognisable loop
    // show-piece. Not yet a driveable collider (needs tuned trimesh physics).
    const radius = TILE * 0.7
    const geometry = new THREE.TorusGeometry(radius, TILE * 0.12, 12, 32)
    const mesh = new THREE.Mesh(geometry, this._material(el.color, { metalness: 0.3, roughness: 0.5 }))
    mesh.position.set(center.x, GROUND_Y + radius, center.z)
    mesh.rotation.y = this._yaw(el.orient) + Math.PI / 2 // face the loop across travel
    mesh.castShadow = true
    this.group.add(mesh)
  }

  _addTubeVisual(el, center) {
    // A half-pipe arch over the drivable base (pipe/tunnel show-piece).
    const radius = TILE * 0.5
    const geometry = new THREE.TorusGeometry(radius, TILE * 0.08, 10, 24, Math.PI)
    const mesh = new THREE.Mesh(geometry, this._material(el.color, { metalness: 0.2, roughness: 0.6 }))
    mesh.position.set(center.x, GROUND_Y, center.z)
    mesh.rotation.y = this._yaw(el.orient)
    mesh.castShadow = true
    this.group.add(mesh)
  }

  _addScenery(el, center) {
    // Non-colliding grass props. Trees/cactus/tennis court sit on the terrain
    // and never touch the racing line.
    const g = new THREE.Group()
    g.position.set(center.x, GROUND_Y, center.z)

    if (el.sceneryKind === 'tennis') {
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(TILE * 0.7, 0.3, TILE * 0.7),
        this._material(0x2f7d4f)
      )
      pad.position.y = 0.15
      pad.receiveShadow = true
      g.add(pad)
    } else {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.8, 5, 8),
        this._material(0x6b4a2a)
      )
      trunk.position.y = 2.5
      trunk.castShadow = true
      g.add(trunk)

      if (el.sceneryKind === 'cactus') {
        trunk.material = this._material(0x3f7a3a)
        trunk.scale.set(0.7, 1.1, 0.7)
      } else {
        const foliageColor = el.sceneryKind === 'palm' ? 0x4caf50 : 0x2e7d32
        const foliage = new THREE.Mesh(
          new THREE.ConeGeometry(TILE * 0.28, 8, 8),
          this._material(foliageColor)
        )
        foliage.position.y = 8
        foliage.castShadow = true
        g.add(foliage)
      }
    }
    this.group.add(g)
  }

  _addBuilding(el, center) {
    // Solid box obstacle sitting on grass — you can crash into these.
    const w = TILE * 0.6
    const h = TILE * 0.55
    const geometry = new THREE.BoxGeometry(w, h, w)
    const mesh = new THREE.Mesh(geometry, this._material(0xc2b280))
    mesh.position.set(center.x, GROUND_Y + h / 2, center.z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)

    // Simple roof for silhouette.
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(w * 0.8, h * 0.5, 4),
      this._material(0x8a3b2e)
    )
    roof.position.set(center.x, GROUND_Y + h + h * 0.25, center.z)
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    this.group.add(roof)

    this._addBoxCollider(mesh.position, new CANNON.Vec3(w / 2, h / 2, w / 2))
  }

  _addBoxCollider(position, halfExtents) {
    const body = new CANNON.Body({ mass: 0, material: this.physicsWorld.defaultMaterial })
    body.addShape(new CANNON.Box(halfExtents))
    body.position.set(position.x, position.y, position.z)
    body.updateAABB()
    this.physicsWorld.addBody(body)
    this.colliderBodies.push(body)
  }

  /** Spawn point: first start/finish tile, else first drivable road tile. */
  _findStart() {
    let firstDrivable = null
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const el = describeElement(this.trackFile.trackAt(x, y))
        if (!el.drivable) continue
        const pos = this.tileToWorld(x, y)
        pos.y = GROUND_Y + 3
        if (el.category === CATEGORY.START) return pos
        if (!firstDrivable) firstDrivable = pos
      }
    }
    return firstDrivable ?? new THREE.Vector3(0, 3, 0)
  }

  dispose() {
    for (const body of this.colliderBodies) this.physicsWorld.removeBody(body)
    this.colliderBodies.length = 0
    this.group.traverse((child) => {
      if (child.isMesh) child.geometry.dispose()
    })
    this.group.removeFromParent()
  }
}
