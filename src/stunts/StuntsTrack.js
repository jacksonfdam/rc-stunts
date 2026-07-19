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
const ROAD_H = 0.15 // flat slab thickness — kept low so road sits nearly flush
// with the grass; a taller slab shows dark side-walls where a curved corner
// (a thin plane) meets a straight (a box), which reads as a broken seam.
const ELEV_H = 4 // height of raised/elevated pieces (kept modest so raised roads
// read as a low overpass rather than a tall wall)
const RAMP_RISE = ELEV_H // vertical rise across one ramp tile
// Road pieces span the full tile so adjacent cells butt flush into one
// continuous ribbon, as in the original game — no gaps between road blocks.
const INSET = 1.0

export class StuntsTrack {
  constructor(scene, physicsWorld, trackFile) {
    this.scene = scene
    this.physicsWorld = physicsWorld
    this.trackFile = trackFile

    this.group = new THREE.Group()
    this.scene.add(this.group)
    this.colliderBodies = []
    this._materials = new Map()
    // Loop descriptors (centre, radius, travel/width axes) so the game loop can
    // apply a stick-to-surface assist that carries the car around the loop.
    this.loops = []

    // Centre the grid on the origin so (0,0) tile sits at -halfExtent.
    this.origin = -((GRID - 1) * TILE) / 2

    // Set by _findStart: whether the track has a real start/finish tile (so lap
    // timing is meaningful) — false tracks just spawn at the first road tile.
    this.hasStart = false
    this._buildGround()
    this._buildTiles()
    this.start = this._findStart()
    this.route = []
    this._buildRoute()
    this._buildStartLine()
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
    // Visual ground extends far past the grid so its edge never shows on the
    // horizon — the distance just fades into fog / the sky dome.
    const geometry = new THREE.PlaneGeometry(span * 8, span * 8)
    geometry.rotateX(-Math.PI / 2)
    const material = new THREE.MeshStandardMaterial({ color: 0x4b5d2f, roughness: 1 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.y = GROUND_Y - 0.05
    mesh.receiveShadow = true
    this.group.add(mesh)

    // Static ground plane collider (sized to the grid). A rotated CANNON.Plane
    // fails vehicle raycasts, so use a thick box just below the surface instead.
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
        this._buildPiece(el, center, x, y)
      }
    }
  }

  _buildPiece(el, center, x, y) {
    switch (el.category) {
      case CATEGORY.RAMP:
        this._addRamp(el, center)
        break
      case CATEGORY.ELEVATED:
      case CATEGORY.ELEVATED_CORNER:
        this._addElevated(el, center)
        break
      case CATEGORY.LOOP:
        this._addLoop(el, center)
        break
      case CATEGORY.PIPE:
      case CATEGORY.TUNNEL:
        this._addPipe(el, center)
        break
      case CATEGORY.SCENERY:
        this._addScenery(el, center)
        break
      case CATEGORY.BUILDING:
        this._addBuilding(el, center)
        break
      // ROAD, CORNER, JUNCTION, CHICANE, BANKED, START, FILLER, HIGHWAY,
      // CORKSCREW — flush road; convex outer corners are rounded from the
      // neighbour layout (orientation-independent, so never inverted).
      default:
        this._addFlat(el, center, x, y)
    }
  }

  /** Yaw (about Y) for a piece's orientation index. */
  _yaw(orient) {
    return orient * (Math.PI / 2)
  }

  _addFlat(el, center, x, y) {
    // A tile whose only two drivable orthogonal neighbours are perpendicular is
    // a bend — render a curved road pie whose apex is the vertex where those two
    // road edges meet (grass on the outer corner). Derived from the neighbour
    // layout, so the curve always matches the actual turn and is never inverted.
    if (x !== undefined) {
      const N = this._drivableAt(x, y + 1)
      const S = this._drivableAt(x, y - 1)
      const E = this._drivableAt(x + 1, y)
      const W = this._drivableAt(x - 1, y)
      if (N + S + E + W === 2 && !(N && S) && !(E && W)) {
        const h = TILE / 2
        const HALF = Math.PI / 2
        let m
        if (N && E) m = { ox: +h, oz: +h, theta: HALF }
        else if (N && W) m = { ox: -h, oz: +h, theta: 0 }
        else if (S && E) m = { ox: +h, oz: -h, theta: Math.PI }
        else m = { ox: -h, oz: -h, theta: 3 * HALF } // S && W
        const geometry = new THREE.RingGeometry(0, TILE, 40, 1, m.theta, HALF)
        geometry.rotateX(-HALF)
        const mesh = new THREE.Mesh(geometry, this._material(el.color))
        mesh.position.set(center.x + m.ox, GROUND_Y + ROAD_H, center.z + m.oz)
        mesh.receiveShadow = true
        this.group.add(mesh)
        this._addBoxCollider(
          new THREE.Vector3(center.x, GROUND_Y + ROAD_H / 2, center.z),
          new CANNON.Vec3(TILE / 2, ROAD_H / 2, TILE / 2)
        )
        return
      }
    }

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
    // Ascent yaw per quadrant, calibrated against the corpus: Q1→E, Q2→N, Q3→W,
    // Q4→S. This scores 96.7% "ramp ascends toward its raised neighbour" over
    // 395 unambiguous bridge ramps in 84 tracks (a full dihedral search — a plain
    // rotation offset couldn't align all four ids). The mesh tilts its +Z end up,
    // and yaw θ points that end along (sinθ, cosθ).
    const RAMP_YAW = { 1: Math.PI / 2, 2: 0, 3: (3 * Math.PI) / 2, 4: Math.PI }
    const yaw = RAMP_YAW[el.quadrant] ?? 0
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
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
    // A raised bridge span: an earthen support block up to ELEV_H (matching the
    // ramps' brown), with a paved road cap on top. The top sits at ELEV_H so a
    // ramp's high end meets it flush.
    const w = TILE * INSET
    const support = new THREE.Mesh(
      new THREE.BoxGeometry(w, ELEV_H, w),
      this._material(0x6d5a34)
    )
    support.position.set(center.x, GROUND_Y + ELEV_H / 2, center.z)
    support.castShadow = true
    support.receiveShadow = true
    this.group.add(support)

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(w, ROAD_H, w),
      this._material(0x44454b)
    )
    cap.position.set(center.x, GROUND_Y + ELEV_H + ROAD_H / 2, center.z)
    cap.castShadow = true
    cap.receiveShadow = true
    this.group.add(cap)

    this._addBoxCollider(
      new THREE.Vector3(center.x, GROUND_Y + ELEV_H / 2, center.z),
      new CANNON.Vec3(w / 2, (ELEV_H + ROAD_H) / 2, w / 2)
    )
  }

  /**
   * Builds a drivable curved surface (visual mesh + CANNON.Trimesh collider)
   * from `rings`: an array of cross-sections, each an array of local [x,y,z]
   * points (same length). Consecutive rings are stitched into quads. Points are
   * yawed about Y and translated to `center`, and the world coordinates are
   * baked into both the geometry and the trimesh so the collider is exact.
   */
  _addSweptSurface(rings, center, yaw, color) {
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const K = rings.length
    const M = rings[0].length
    const positions = new Float32Array(K * M * 3)
    let o = 0
    for (let r = 0; r < K; r++) {
      for (let m = 0; m < M; m++) {
        const [x, y, z] = rings[r][m]
        positions[o++] = x * cos + z * sin + center.x
        positions[o++] = y + center.y
        positions[o++] = -x * sin + z * cos + center.z
      }
    }
    const indices = []
    for (let r = 0; r < K - 1; r++) {
      for (let m = 0; m < M - 1; m++) {
        const a = r * M + m
        const b = r * M + m + 1
        const c = (r + 1) * M + m + 1
        const d = (r + 1) * M + m
        indices.push(a, b, d, b, c, d)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.15,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)

    const trimesh = new CANNON.Trimesh(Array.from(positions), indices)
    const body = new CANNON.Body({ mass: 0, material: this.physicsWorld.defaultMaterial })
    body.addShape(trimesh)
    body.updateAABB()
    this.physicsWorld.addBody(body)
    this.colliderBodies.push(body)
  }

  _addLoop(el, center) {
    // A full vertical-circle road ribbon in the travel plane: enters at ground
    // going +travel, curves up and over. The car needs speed to keep contact at
    // the top (see the speed-gated upright assist in Vehicle.js).
    const RL = TILE * 0.85
    const halfW = TILE * 0.36
    const SEGMENTS = 40
    const rings = []
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2
      const y = RL - RL * Math.cos(a)
      const z = RL * Math.sin(a)
      rings.push([
        [-halfW, y, z],
        [halfW, y, z],
      ])
    }
    const yaw = this._yaw(el.orient)
    this._addSweptSurface(rings, center, yaw, el.color)

    // Record the loop for the stick-to-surface assist. The circle lies in the
    // vertical plane through the travel axis; its centre is one radius above the
    // entry tile. wx/wz is the horizontal width axis (out-of-plane direction).
    this.loops.push({
      cx: center.x,
      cz: center.z,
      cy: RL, // circle centre height (entry is at y=0)
      RL,
      halfW,
      wx: Math.cos(yaw), // horizontal width axis (out of loop plane)
      wz: -Math.sin(yaw),
      tdx: Math.sin(yaw), // horizontal travel direction (into the loop)
      tdz: Math.cos(yaw),
    })
  }

  _addPipe(el, center) {
    // A concave half-pipe trough along travel: the floor sits at ground level
    // and curves up into walls, so you drive through it and can ride the sides.
    const R = TILE * 0.5
    const half = (TILE * INSET) / 2
    const PHI = 2.15 // half-arc of the trough (radians up each wall)
    const M = 11
    const cross = []
    for (let j = 0; j < M; j++) {
      const phi = -PHI + 2 * PHI * (j / (M - 1))
      cross.push([R * Math.sin(phi), R - R * Math.cos(phi)])
    }
    const rings = [
      cross.map(([x, y]) => [x, y, -half]),
      cross.map(([x, y]) => [x, y, half]),
    ]
    this._addSweptSurface(rings, center, this._yaw(el.orient), el.color)
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
    let firstCell = null
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const el = describeElement(this.trackFile.trackAt(x, y))
        if (!el.drivable) continue
        const pos = this.tileToWorld(x, y)
        pos.y = GROUND_Y + 3
        if (el.category === CATEGORY.START) {
          this.hasStart = true
          this.startCell = { x, y }
          return pos
        }
        if (!firstDrivable) {
          firstDrivable = pos
          firstCell = { x, y }
        }
      }
    }
    this.startCell = firstCell ?? { x: 15, y: 15 }
    return firstDrivable ?? new THREE.Vector3(0, 3, 0)
  }

  _drivableAt(x, y) {
    if (x < 0 || x >= GRID || y < 0 || y >= GRID) return false
    return describeElement(this.trackFile.trackAt(x, y)).drivable
  }

  _tileHeight(x, y) {
    const c = describeElement(this.trackFile.trackAt(x, y)).category
    if (c === CATEGORY.ELEVATED || c === CATEGORY.ELEVATED_CORNER) return ELEV_H
    if (c === CATEGORY.RAMP) return ELEV_H / 2
    return ROAD_H
  }

  /**
   * Trace an ordered lap route (world-space tile centres) for the AI opponent:
   * a greedy walk from the start tile that follows drivable neighbours, preferring
   * to keep going straight, until it loops back or dead-ends. Good enough to send
   * a ghost car roughly around the circuit.
   */
  _buildRoute() {
    const route = []
    const start = this.startCell
    if (!start) {
      this.route = route
      return
    }
    const DIRS = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
    const key = (c) => c.y * GRID + c.x
    const visited = new Set()
    let cur = { ...start }
    let prev = null
    let lastDir = null
    const centre = new THREE.Vector3()
    for (let step = 0; step < GRID * GRID; step++) {
      this.tileToWorld(cur.x, cur.y, centre)
      // Route y = the road surface height at this tile; the opponent car's mesh
      // is modelled with its wheels' contact at its own origin, so it sits flush.
      route.push(new THREE.Vector3(centre.x, this._tileHeight(cur.x, cur.y), centre.z))
      visited.add(key(cur))

      const cands = DIRS.map(([dx, dy]) => ({ x: cur.x + dx, y: cur.y + dy, dx, dy })).filter(
        (n) => this._drivableAt(n.x, n.y) && !(prev && n.x === prev.x && n.y === prev.y)
      )
      if (!cands.length) break
      let next =
        (lastDir && cands.find((n) => n.dx === lastDir.dx && n.dy === lastDir.dy)) ||
        cands.find((n) => !visited.has(key(n))) ||
        cands[0]
      lastDir = { dx: next.dx, dy: next.dy }
      prev = cur
      cur = { x: next.x, y: next.y }
      if (route.length > 3 && cur.x === start.x && cur.y === start.y) break
    }
    this.route = route
  }

  /** A fresh 2×2 checker texture (repeat it to get the square count you want). */
  _checkerTexture(repeatX, repeatY) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const ctx = canvas.getContext('2d')
    const s = 16
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#111318' : '#f8fafc'
        ctx.fillRect(i * s, j * s, s, s)
      }
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeatX, repeatY)
    tex.anisotropy = 4
    return tex
  }

  /** Checkered start/finish line on the road plus a checkered banner overhead. */
  _buildStartLine() {
    if (!this.startCell) return
    const c = this.tileToWorld(this.startCell.x, this.startCell.y, new THREE.Vector3())
    let yaw = 0
    if (this.route.length >= 2) {
      const f = this.route[1].clone().sub(this.route[0])
      yaw = Math.atan2(f.x, f.z) // car forward (+Z) → (sin, cos)
    }
    const ax = Math.cos(yaw) // horizontal axis across the track
    const az = -Math.sin(yaw)
    const half = TILE * 0.5

    // Checkered strip painted flat on the road, spanning the track width.
    const stripGeo = new THREE.PlaneGeometry(TILE, TILE * 0.35)
    stripGeo.rotateX(-Math.PI / 2)
    const strip = new THREE.Mesh(
      stripGeo,
      new THREE.MeshStandardMaterial({ map: this._checkerTexture(8, 2), roughness: 0.7 })
    )
    strip.position.set(c.x, GROUND_Y + ROAD_H + 0.04, c.z)
    strip.rotation.y = yaw
    strip.receiveShadow = true
    this.group.add(strip)

    // Two posts and a checkered banner across the top.
    const postGeo = new THREE.CylinderGeometry(0.35, 0.35, 6.5, 8)
    const postMat = this._material(0xe5e7eb)
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat)
      post.position.set(c.x + ax * half * s, GROUND_Y + 3.25, c.z + az * half * s)
      post.castShadow = true
      this.group.add(post)
    }
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE, 1.8),
      new THREE.MeshStandardMaterial({ map: this._checkerTexture(10, 2), roughness: 0.7, side: THREE.DoubleSide })
    )
    banner.position.set(c.x, GROUND_Y + 5.7, c.z)
    banner.rotation.y = yaw
    banner.castShadow = true
    this.group.add(banner)
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
