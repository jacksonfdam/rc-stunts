import * as THREE from 'three'
import * as CANNON from 'cannon-es'

import { GRID } from './TrackFile.js'
import { describeElement } from './trackElements.js'

/**
 * Builds a drivable scene from a parsed Stunts `TrackFile`: a ground plane,
 * one placeholder block per non-empty track tile, and matching static
 * colliders. This mirrors World.js (visual mesh + physics collider from the
 * same source data) but generates geometry procedurally from the 30x30 grid
 * instead of loading a level GLB.
 *
 * Flat placeholder tiles use CANNON.Box colliders (not Trimesh) — boxes
 * collide cleanly with the vehicle's box chassis, so the corner-sphere trick
 * World.js needs for trimeshes doesn't apply here yet. Ramps/loops will move
 * to trimesh colliders when real geometry replaces the blocks.
 */

// World units per grid tile. Real Stunts tiles are ~62.5 m; we use a smaller,
// gameplay-tuned size so the existing ~4 m car feels right on the road.
export const TILE = 24
const GROUND_Y = 0

export class StuntsTrack {
  constructor(scene, physicsWorld, trackFile) {
    this.scene = scene
    this.physicsWorld = physicsWorld
    this.trackFile = trackFile

    this.group = new THREE.Group()
    this.scene.add(this.group)
    this.colliderBodies = []

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
    const materialCache = new Map()
    const getMaterial = (color) => {
      let material = materialCache.get(color)
      if (!material) {
        material = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 })
        materialCache.set(color, material)
      }
      return material
    }

    const center = new THREE.Vector3()
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const element = describeElement(this.trackFile.trackAt(x, y))
        if (!element.drivable) continue

        this.tileToWorld(x, y, center)

        // Slightly inset so tile seams read as a grid.
        const width = TILE * 0.94
        const geometry = new THREE.BoxGeometry(width, element.height, width)
        const mesh = new THREE.Mesh(geometry, getMaterial(element.color))
        mesh.position.set(center.x, GROUND_Y + element.height / 2, center.z)
        mesh.castShadow = true
        mesh.receiveShadow = true
        this.group.add(mesh)

        const body = new CANNON.Body({ mass: 0, material: this.physicsWorld.defaultMaterial })
        body.addShape(new CANNON.Box(new CANNON.Vec3(width / 2, element.height / 2, width / 2)))
        body.position.set(center.x, GROUND_Y + element.height / 2, center.z)
        body.updateAABB()
        this.physicsWorld.addBody(body)
        this.colliderBodies.push(body)
      }
    }
  }

  /** First drivable tile scanning bottom→top, left→right — the spawn point. */
  _findStart() {
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (describeElement(this.trackFile.trackAt(x, y)).drivable) {
          const pos = this.tileToWorld(x, y)
          pos.y = GROUND_Y + 3
          return pos
        }
      }
    }
    return new THREE.Vector3(0, 3, 0)
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
