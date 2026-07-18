import * as THREE from 'three'
import * as CANNON from 'cannon-es'

import { Vehicle } from '../Vehicle.js'
import { TrackFile, createDemoTrackFile } from './TrackFile.js'
import { describeElement } from './trackElements.js'
import { StuntsTrack, TILE } from './StuntsTrack.js'
import { GRID } from './TrackFile.js'

// --- Renderer & scene --------------------------------------------------------

const container = document.getElementById('app')

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
container.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x8fb7d6)
scene.fog = new THREE.Fog(0x8fb7d6, TILE * 12, TILE * 26)

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  4000
)
camera.position.set(0, 40, -40)

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a4a3a, 1.4)
scene.add(hemi)

const sun = new THREE.DirectionalLight(0xfff2d9, 2.4)
sun.position.set(60, 90, 30)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -TILE * 4
sun.shadow.camera.right = TILE * 4
sun.shadow.camera.top = TILE * 4
sun.shadow.camera.bottom = -TILE * 4
sun.shadow.camera.far = 400
sun.shadow.bias = -0.0002
sun.shadow.normalBias = 0.03
scene.add(sun)
scene.add(sun.target)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// --- Physics -----------------------------------------------------------------

const physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) })
physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld)
physicsWorld.allowSleep = true
physicsWorld.defaultContactMaterial.friction = 0.3

// --- Vehicle -----------------------------------------------------------------

const vehicle = new Vehicle(scene, physicsWorld)

// --- Track -------------------------------------------------------------------

let track = null

function countDrivable(trackFile) {
  let n = 0
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (describeElement(trackFile.trackAt(x, y)).drivable) n++
    }
  }
  return n
}

function loadTrack(trackFile, name) {
  if (track) track.dispose()
  track = new StuntsTrack(scene, physicsWorld, trackFile)

  // Spawn the car just above the first drivable tile, nose pointing +Z.
  vehicle.spawnPosition.set(track.start.x, track.start.y + 2, track.start.z)
  vehicle.spawnQuaternion.set(0, 0, 0, 1)
  vehicle.respawn()

  document.getElementById('track-name').textContent = name
  document.getElementById('horizon-name').textContent = trackFile.horizonName
  document.getElementById('tile-count').textContent = countDrivable(trackFile)
}

loadTrack(createDemoTrackFile(), 'demo loop')

// Load a real .TRK from disk.
document.getElementById('trk-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  const buffer = await file.arrayBuffer()
  loadTrack(TrackFile.parse(buffer), file.name)
})

// --- Chase camera ------------------------------------------------------------

const cameraOffset = new THREE.Vector3(0, 7, -13)
const lookOffset = new THREE.Vector3(0, 2, 6)
const desiredPosition = new THREE.Vector3()
const desiredTarget = new THREE.Vector3()
const currentTarget = new THREE.Vector3()
currentTarget.copy(vehicle.group.position)

function updateCamera(delta) {
  const chassis = vehicle.group
  desiredPosition.copy(cameraOffset).applyQuaternion(chassis.quaternion).add(chassis.position)
  desiredPosition.y = Math.max(desiredPosition.y, chassis.position.y + 3)
  desiredTarget.copy(lookOffset).applyQuaternion(chassis.quaternion).add(chassis.position)

  camera.position.lerp(desiredPosition, 1 - Math.exp(-6 * delta))
  currentTarget.lerp(desiredTarget, 1 - Math.exp(-10 * delta))
  camera.lookAt(currentTarget)
}

// --- Loop --------------------------------------------------------------------

const FIXED_STEP = 1 / 60
let lastTime = performance.now()
const speedValue = document.getElementById('speed-value')

function tick() {
  const now = performance.now()
  const delta = Math.min((now - lastTime) / 1000, 0.1)
  lastTime = now

  physicsWorld.step(FIXED_STEP, delta, 3)
  vehicle.update(delta)
  updateCamera(delta)

  // Keep the sun/shadow frustum centred on the car.
  sun.position.set(
    vehicle.group.position.x + 60,
    vehicle.group.position.y + 90,
    vehicle.group.position.z + 30
  )
  sun.target.position.copy(vehicle.group.position)
  sun.target.updateMatrixWorld()

  speedValue.textContent = Math.round(vehicle.speedKmh)

  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}

tick()
