import * as THREE from 'three'
import * as CANNON from 'cannon-es'

import { Vehicle } from '../Vehicle.js'
import { TrackFile, createDemoTrackFile } from './TrackFile.js'
import { describeElement } from './trackElements.js'
import { StuntsTrack, TILE } from './StuntsTrack.js'
import { GRID } from './TrackFile.js'

// Selectable car models (dropped in src/assets, imported as URLs).
import baseCarUrl from '../assets/base.glb?url'
import mustangUrl from '../assets/low_poly_ford_mustang.glb?url'
import gtrUrl from '../assets/low_poly_nissan_gtr.glb?url'
import camaroUrl from '../assets/low_poly_chevrolet_camaro.glb?url'
import ferrariUrl from '../assets/low_poly_ferrari_br20.glb?url'
import z4Url from '../assets/low_poly_bmw_z4_coupe.glb?url'
import silviaUrl from '../assets/low_poly_nissan_silvia_s15.glb?url'

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
const HORIZON_COLOR = 0x9cc3e0
scene.background = new THREE.Color(HORIZON_COLOR)
// Fog fades distant ground into the horizon colour so the ground's edge and the
// sky-dome base blend into one seamless horizon band.
scene.fog = new THREE.Fog(HORIZON_COLOR, TILE * 16, TILE * 40)

// Gradient sky dome: deep blue overhead easing to the horizon colour at the
// skyline. Unfogged and drawn behind everything.
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  fog: false,
  depthWrite: false,
  uniforms: {
    topColor: { value: new THREE.Color(0x2f6bb0) },
    horizonColor: { value: new THREE.Color(HORIZON_COLOR) },
  },
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vDir;
    uniform vec3 topColor;
    uniform vec3 horizonColor;
    void main() {
      float h = clamp(vDir.y, 0.0, 1.0);
      gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, 0.6)), 1.0);
    }
  `,
})
const sky = new THREE.Mesh(new THREE.SphereGeometry(3200, 32, 16), skyMat)
scene.add(sky)

// Distant mountain band so the horizon isn't empty. Two rings of low-poly
// peaks (green hills in front, grey/snow behind) circling the scene; unfogged
// so they read clearly on the skyline.
function buildHorizon() {
  const ring = new THREE.Group()
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x3f5d38, roughness: 1, flatShading: true, fog: false })
  const peakMat = new THREE.MeshStandardMaterial({ color: 0x8892a0, roughness: 1, flatShading: true, fog: false })
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 1, flatShading: true, fog: false })
  const layers = [
    { count: 90, R: 900, base: 60, vary: 90, rad: 90, mat: hillMat, snow: false },
    { count: 70, R: 1050, base: 130, vary: 170, rad: 120, mat: peakMat, snow: true },
  ]
  for (const L of layers) {
    for (let i = 0; i < L.count; i++) {
      const a = (i / L.count) * Math.PI * 2 + ((i * 37) % 13) * 0.01
      const h = L.base + ((i * 53) % L.vary)
      const r = L.R + ((i * 29) % 140)
      const cone = new THREE.Mesh(new THREE.ConeGeometry(L.rad + ((i * 17) % 50), h, 5), L.mat)
      cone.position.set(Math.cos(a) * r, h / 2 - 30, Math.sin(a) * r)
      cone.rotation.y = i * 1.3
      ring.add(cone)
      if (L.snow && h > 200) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry((L.rad + ((i * 17) % 50)) * 0.4, h * 0.28, 5), snowMat)
        cap.position.set(cone.position.x, cone.position.y + h * 0.36, cone.position.z)
        cap.rotation.y = cone.rotation.y
        ring.add(cap)
      }
    }
  }
  scene.add(ring)
}
buildHorizon()

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

// --- AI opponent -------------------------------------------------------------
// A ghost car that drives the track's route (see StuntsTrack._buildRoute). It's
// not physics-driven — it advances along the ordered tile-centre path at a fixed
// pace and orients to its heading, so it reliably completes the circuit.
const oppHint = document.getElementById('opp-hint')

function buildOpponentCar() {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 1.1, 6),
    new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.4, metalness: 0.1 })
  )
  // Modelled with wheel-contact at the group origin (y=0) so placing the group
  // on the road surface sits it flush (wheel radius 1 → centre at y=1).
  body.position.y = 1.6
  body.castShadow = true
  g.add(body)
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.9, 2.6),
    new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.3 })
  )
  cabin.position.set(0, 2.4, -0.2)
  g.add(cabin)
  const wheelGeo = new THREE.CylinderGeometry(1, 1, 0.8, 12)
  wheelGeo.rotateZ(Math.PI / 2)
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.8 })
  for (const [x, z] of [[-1.8, 2], [1.8, 2], [-1.8, -2], [1.8, -2]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat)
    w.position.set(x, 1, z)
    g.add(w)
  }
  return g
}

const OPP_START_LEAD = TILE * 1.6 // start ahead of the player so they don't overlap
const opponent = { group: buildOpponentCar(), idx: 0, t: 0, speed: 21, active: false }
scene.add(opponent.group)
opponent.group.visible = false
const _oppDir = new THREE.Vector3()

// Kinematic collision body — a box that follows the ghost and shoves the
// player's (dynamic) car. Kinematic ⇒ it never collides with the static track.
const opponentBody = new CANNON.Body({
  mass: 0,
  type: CANNON.Body.KINEMATIC,
  material: physicsWorld.defaultMaterial,
})
opponentBody.addShape(new CANNON.Box(new CANNON.Vec3(1.6, 1.0, 3.0)))
physicsWorld.addBody(opponentBody)
const _oppUp = new CANNON.Vec3(0, 1, 0)

function advanceOpponent(dist) {
  const route = track.route
  let remaining = dist
  for (let guard = 0; guard < route.length + 2 && remaining > 0; guard++) {
    const a = route[opponent.idx]
    const b = route[(opponent.idx + 1) % route.length]
    const segLen = a.distanceTo(b) || 0.0001
    const segLeft = segLen * (1 - opponent.t)
    if (remaining < segLeft) {
      opponent.t += remaining / segLen
      remaining = 0
    } else {
      remaining -= segLeft
      opponent.idx = (opponent.idx + 1) % route.length
      opponent.t = 0
    }
  }
}

function placeOpponent() {
  const route = track.route
  const a = route[opponent.idx]
  const b = route[(opponent.idx + 1) % route.length]
  opponent.group.position.lerpVectors(a, b, opponent.t)
  _oppDir.copy(b).sub(a)
  const yaw = _oppDir.lengthSq() > 0.0001 ? Math.atan2(_oppDir.x, _oppDir.z) : 0
  opponent.group.rotation.y = yaw
  const p = opponent.group.position
  opponentBody.position.set(p.x, p.y + 1, p.z)
  opponentBody.quaternion.setFromAxisAngle(_oppUp, yaw)
}

function resetOpponent() {
  opponent.idx = 0
  opponent.t = 0
  opponent.active = !!(track && track.route && track.route.length > 2)
  opponent.group.visible = opponent.active
  opponentBody.collisionResponse = opponent.active
  if (opponent.active) {
    advanceOpponent(OPP_START_LEAD) // line up ahead of the player, not on top
    placeOpponent()
  }
}

function updateOpponent(delta) {
  if (!opponent.active) return
  // Hold at the start line until the race begins (menu closed).
  if (!menuEl.classList.contains('hidden')) return
  advanceOpponent(opponent.speed * delta)
  placeOpponent()

  const near = opponent.group.position.distanceTo(vehicle.group.position) < TILE * 1.6
  oppHint.classList.toggle('hidden', !near)
}

// --- Race position (you vs the opponent) -------------------------------------
const posValue = document.getElementById('pos-value')
const _posP = new THREE.Vector3()

function updatePosition() {
  if (!track || !track.route || track.route.length < 3 || !opponent.active) return
  const route = track.route
  const p = vehicle.group.position
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < route.length; i++) {
    const d = route[i].distanceToSquared(p)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  // Higher route index = further round the lap. (Single-lap approximation.)
  posValue.textContent = best >= opponent.idx ? '1st' : '2nd'
}

// --- Sound (procedural engine + crash thud, no audio assets) -----------------
let audioCtx = null
let engineOsc = null
let subOsc = null
let engineGain = null
let soundOn = true
const soundBtn = document.getElementById('sound-btn')

function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume()
    return
  }
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  audioCtx = new AC()
  engineOsc = audioCtx.createOscillator()
  engineOsc.type = 'sawtooth'
  subOsc = audioCtx.createOscillator()
  subOsc.type = 'square'
  const filter = audioCtx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 950
  engineGain = audioCtx.createGain()
  engineGain.gain.value = 0
  engineOsc.connect(filter)
  subOsc.connect(filter)
  filter.connect(engineGain)
  engineGain.connect(audioCtx.destination)
  engineOsc.frequency.value = 55
  subOsc.frequency.value = 28
  engineOsc.start()
  subOsc.start()
}

function updateAudio(driving) {
  if (!audioCtx || !soundOn) return
  const t = audioCtx.currentTime
  if (resultsOpen) {
    engineGain.gain.setTargetAtTime(0, t, 0.08) // engine off when the race ends
    return
  }
  const spd = vehicle.speedKmh
  const f = 55 + spd * 2.4
  engineOsc.frequency.setTargetAtTime(f, t, 0.06)
  subOsc.frequency.setTargetAtTime(f * 0.5, t, 0.06)
  const boosting = vehicle.input.boost || vehicle.input.gamepadBoost
  const target = (driving ? 0.05 : 0.022) * (boosting ? 1.5 : 1)
  engineGain.gain.setTargetAtTime(target, t, 0.1)
}

function playThud() {
  if (!audioCtx || !soundOn) return
  const dur = 0.35
  const buffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = audioCtx.createBufferSource()
  src.buffer = buffer
  const lp = audioCtx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 500
  const g = audioCtx.createGain()
  g.gain.value = 0.45
  src.connect(lp)
  lp.connect(g)
  g.connect(audioCtx.destination)
  src.start()
}

soundBtn.addEventListener('click', () => {
  soundOn = !soundOn
  soundBtn.textContent = soundOn ? '🔊' : '🔇'
  if (soundOn) initAudio()
  else if (engineGain) engineGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05)
})

// --- Run / lap timer ---------------------------------------------------------
// Starts on the player's first throttle input (not spawn drift) and resets on
// respawn (R) or track load. On tracks with a start/finish tile it times laps:
// the big readout is the current lap, and it records the best lap and lap count
// each time the car crosses the start tile. Tracks without a start tile fall
// back to a plain elapsed-time stopwatch.
const timerEl = document.getElementById('timer')
const timerValue = document.getElementById('timer-value')
const timerLabel = document.getElementById('timer-label')
const lapInfo = document.getElementById('lap-info')
const lapCountEl = document.getElementById('lap-count')
const bestLapEl = document.getElementById('best-lap')
const START_RADIUS = TILE * 0.6 // how close counts as "on" the start tile
const MIN_LAP_SECONDS = 2 // debounce so one crossing can't count twice

let runTime = 0
let timing = false
let lapStart = 0
let bestLap = Infinity
let lapCount = 1
let wasOnStart = true // car spawns on the start tile
// Per-lap stats for the results screen.
let lapTop = 0
let lapSpeedSum = 0
let lapSpeedN = 0
let lapJumps = 0
let wasGrounded = true

function resetLapStats() {
  lapTop = 0
  lapSpeedSum = 0
  lapSpeedN = 0
  lapJumps = 0
  wasGrounded = true
}

function resetTimer() {
  runTime = 0
  timing = false
  lapStart = 0
  bestLap = Infinity
  lapCount = 1
  wasOnStart = true
  resetLapStats()
  timerEl.classList.add('idle')
  timerValue.textContent = '0:00.000'
  lapCountEl.textContent = '1'
  bestLapEl.textContent = '—'
}

function isGrounded() {
  const wheels = vehicle.raycastVehicle.wheelInfos
  for (const w of wheels) if (w.isInContact) return true
  return false
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds * 1000) % 1000)
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

function updateTimer(delta, driving, carPos) {
  if (resultsOpen) return // frozen while the results screen is up
  if (!timing && driving) {
    timing = true
    timerEl.classList.remove('idle')
  }
  if (!timing) return
  runTime += delta

  // Accumulate per-lap stats.
  const spd = vehicle.speedKmh
  lapTop = Math.max(lapTop, spd)
  lapSpeedSum += spd
  lapSpeedN++
  const grounded = isGrounded()
  if (wasGrounded && !grounded && spd > 20) lapJumps++ // took off at speed
  wasGrounded = grounded

  if (track && track.hasStart) {
    const dx = carPos.x - track.start.x
    const dz = carPos.z - track.start.z
    const onStart = dx * dx + dz * dz < START_RADIUS * START_RADIUS
    const lapElapsed = runTime - lapStart
    if (onStart && !wasOnStart && lapElapsed > MIN_LAP_SECONDS) {
      if (lapElapsed < bestLap) {
        bestLap = lapElapsed
        bestLapEl.textContent = formatTime(bestLap)
      }
      lapCount++
      lapCountEl.textContent = String(lapCount)
      finishLap(lapElapsed)
      lapStart = runTime
      resetLapStats()
    }
    wasOnStart = onStart
    timerValue.textContent = formatTime(runTime - lapStart)
  } else {
    timerValue.textContent = formatTime(runTime)
  }
}

// R respawns the car (handled inside Vehicle); mirror it here to reset the clock.
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR') resetTimer()
})

// --- Results / fastest times -------------------------------------------------
const resultsEl = document.getElementById('results')
const resultsTrack = document.getElementById('results-track')
const resultsList = document.getElementById('results-list')
const rsTime = document.getElementById('rs-time')
const rsTop = document.getElementById('rs-top')
const rsAvg = document.getElementById('rs-avg')
const rsJumps = document.getElementById('rs-jumps')
let resultsOpen = false

function finishLap(lapSeconds) {
  const code = document.getElementById('track-name').textContent
  const key = `stunts-times:${code}`
  let times = []
  try {
    times = JSON.parse(localStorage.getItem(key)) || []
  } catch {
    times = []
  }
  times.push({ t: lapSeconds, c: carColor })
  times.sort((a, b) => a.t - b.t)
  times = times.slice(0, 8)
  try {
    localStorage.setItem(key, JSON.stringify(times))
  } catch {
    /* storage may be unavailable; results still show */
  }

  resultsTrack.textContent = code
  resultsList.innerHTML = ''
  times.forEach((e, i) => {
    const li = document.createElement('li')
    const mine = Math.abs(e.t - lapSeconds) < 0.0005
    if (mine) li.className = 'you'
    li.innerHTML =
      `<span class="rank">${i + 1}.</span>` +
      `<span class="who">${mine ? 'You' : '···'}</span>` +
      `<span>${formatTime(e.t)}</span>`
    resultsList.append(li)
  })
  rsTime.textContent = formatTime(lapSeconds)
  rsTop.textContent = Math.round(lapTop)
  rsAvg.textContent = Math.round(lapSpeedSum / Math.max(1, lapSpeedN))
  rsJumps.textContent = String(lapJumps)

  resultsOpen = true
  resultsEl.classList.remove('hidden')
}

document.getElementById('results-continue').addEventListener('click', () => {
  resultsEl.classList.add('hidden')
  resultsOpen = false
})

// --- Loop assist -------------------------------------------------------------
// A raycast vehicle can't complete a vertical loop on physics alone (it rams the
// curving surface and bleeds speed). While the car is on a loop and moving fast,
// press it toward the loop surface (centripetal help, scaled up toward the top)
// and align its roof to the inward normal so the wheels stay on the ribbon.
const UP_VEC = new CANNON.Vec3(0, 1, 0)
const _loopUp = new CANNON.Vec3()
const _loopAxis = new CANNON.Vec3()
const clampf = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function updateLoopAssist() {
  if (!track || !track.loops.length || vehicle.speedKmh < 18) return
  const b = vehicle.chassisBody
  const P = b.position
  for (const L of track.loops) {
    const dx = P.x - L.cx
    const dy = P.y - L.cy
    const dz = P.z - L.cz
    const wdist = dx * L.wx + dz * L.wz // distance out of the loop plane
    if (Math.abs(wdist) > L.halfW + 4) continue
    const ix = dx - wdist * L.wx
    const iy = dy
    const iz = dz - wdist * L.wz
    const radial = Math.hypot(ix, iy, iz)
    if (radial > L.RL + 32 || radial < L.RL - 30) continue

    // Unit vector toward the circle centre (the inward surface normal).
    const nx = -ix / radial
    const ny = -iy / radial
    const nz = -iz / radial
    const heightFactor = clampf(P.y / (2 * L.RL), 0, 1)
    const m = b.mass

    // 1) Hold the car on the tube: moderate radial spring toward radius = RL,
    //    plus centripetal help that grows toward the top so it can't fall off.
    const inward = m * 9.82 * 3.6 * heightFactor + 90 * (radial - L.RL)
    b.applyForce(new CANNON.Vec3(nx * inward, ny * inward, nz * inward))

    // 2) Forward tangent from the car's ANGLE around the loop (reliable even
    //    when nearly stalled, unlike using instantaneous velocity). With the
    //    in-plane offset split into travel (s) and vertical (u) components,
    //    cosα = -u/radial, sinα = s/radial, and the forward tangent is
    //    travelDir*cosα + up*sinα.
    const s = ix * L.tdx + iz * L.tdz
    const cosA = -iy / radial
    const sinA = s / radial
    const fx = L.tdx * cosA
    const fy = sinA
    const fz = L.tdz * cosA
    const vTan = b.velocity.x * fx + b.velocity.y * fy + b.velocity.z * fz
    // Motorise the loop toward a target speed so it can't stall on the climb.
    const TARGET = 60
    const deficit = TARGET - vTan
    if (deficit > 0) {
      const f = m * 32 * clampf(deficit / TARGET, 0, 1)
      b.applyForce(new CANNON.Vec3(fx * f, fy * f, fz * f))
    }

    // 3) Rail the rotation: steer the car's angular velocity toward the rate
    //    the loop demands (ω = v/RL about the width axis, sign = travelDir×up =
    //    -widthAxis) so the chassis keeps tumbling with the loop and the wheels
    //    stay on the ribbon instead of the body detaching past vertical.
    const omega = vTan / L.RL
    const oxT = -L.wx * omega
    const ozT = -L.wz * omega
    const blend = 0.45 * clampf(heightFactor + 0.15, 0, 1)
    b.angularVelocity.x += (oxT - b.angularVelocity.x) * blend
    b.angularVelocity.z += (ozT - b.angularVelocity.z) * blend
    b.angularVelocity.y += (0 - b.angularVelocity.y) * blend * 0.5
  }
}

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

  // Spawn just above the start tile, facing along the track (route[0]→route[1])
  // so the car starts in the correct racing direction, not against it.
  vehicle.spawnPosition.set(track.start.x, track.start.y + 2, track.start.z)
  if (track.route && track.route.length >= 2) {
    const a = track.route[0]
    const b = track.route[1]
    const yaw = Math.atan2(b.x - a.x, b.z - a.z) // nose (+Z) → (sin,cos)
    vehicle.spawnQuaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw)
  } else {
    vehicle.spawnQuaternion.set(0, 0, 0, 1)
  }
  vehicle.respawn()

  document.getElementById('track-name').textContent = name
  document.getElementById('horizon-name').textContent = trackFile.horizonName
  document.getElementById('tile-count').textContent = countDrivable(trackFile)
  resetTimer()
  resetOpponent()
  // Show lap UI only when the track has a start/finish tile to time against.
  lapInfo.classList.toggle('hidden', !track.hasStart)
  timerLabel.textContent = track.hasStart ? 'LAP TIME' : 'TIME'
}

loadTrack(createDemoTrackFile(), 'demo loop')

// --- Bundled community tracks ------------------------------------------------
// Vite resolves every .trk under tracks/ to a served URL at build time, so the
// picker works in both dev and the production build without a manifest.
const trackUrls = import.meta.glob('./tracks/*.trk', { query: '?url', import: 'default', eager: true })

const trackSelect = document.getElementById('track-select')
// Parsed tracks are cached by url so selecting one loads instantly (the .trk
// bytes are inlined as data URIs, so this "fetch" never hits the network).
const trackCache = new Map()

// The .TRK format stores no track name — only the 30x30 grid — and the site
// files were saved under sequential codes (r4k0…), so there's no real name to
// show. Instead we label each entry with its horizon + drivable tile count,
// parsed from the file, and group the list by horizon so tracks are easy to
// tell apart.
async function buildTrackPicker() {
  const parsed = await Promise.all(
    Object.entries(trackUrls).map(async ([path, url]) => {
      const code = path.split('/').pop().replace(/\.trk$/i, '')
      const buffer = await (await fetch(url)).arrayBuffer()
      const tf = TrackFile.parse(buffer)
      trackCache.set(url, { tf, code })
      return { code, url, horizon: tf.horizonName, tiles: countDrivable(tf) }
    })
  )

  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = `— ${parsed.length} bundled tracks —`
  trackSelect.append(placeholder)

  // One <optgroup> per horizon; entries sorted by code within each.
  const byHorizon = new Map()
  for (const e of parsed) {
    if (!byHorizon.has(e.horizon)) byHorizon.set(e.horizon, [])
    byHorizon.get(e.horizon).push(e)
  }
  for (const horizon of [...byHorizon.keys()].sort()) {
    const group = document.createElement('optgroup')
    group.label = horizon
    const list = byHorizon
      .get(horizon)
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    for (const { code, url, tiles } of list) {
      const option = document.createElement('option')
      option.value = url
      option.textContent = `${code} · ${tiles} tiles`
      group.append(option)
    }
    trackSelect.append(group)
  }
}

// Load the cached (or freshly fetched) track for a bundled-track url. Shared by
// the in-game panel select and the start-menu select.
async function loadTrackByUrl(url) {
  if (!url) return
  let cached = trackCache.get(url)
  if (!cached) {
    const buffer = await (await fetch(url)).arrayBuffer()
    cached = { tf: TrackFile.parse(buffer), code: url }
  }
  loadTrack(cached.tf, cached.code)
}

trackSelect.addEventListener('change', (event) => {
  loadTrackByUrl(event.target.value)
  menuTrack.value = event.target.value
  refreshMenuPreview()
})

buildTrackPicker().then(() => {
  // Mirror the parsed/labelled options into the start-menu picker.
  menuTrack.innerHTML = trackSelect.innerHTML
})

// Load a real .TRK from disk.
document.getElementById('trk-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  const buffer = await file.arrayBuffer()
  trackSelect.value = ''
  loadTrack(TrackFile.parse(buffer), file.name)
})

// --- Car colour --------------------------------------------------------------
const CAR_COLORS = [
  0xef4444, 0x2563eb, 0x16a34a, 0xf59e0b, 0xdb2777,
  0x7c3aed, 0x0891b2, 0xe11d48, 0x111827, 0xf8fafc,
]
let carColor = 0xef4444
const swatchEls = [] // all swatches across both palettes, for active-state sync

function setCarColor(color, sourceEl) {
  carColor = color
  vehicle.setBodyColor(color)
  for (const s of swatchEls) s.classList.toggle('active', s === sourceEl)
}

function buildSwatches(container) {
  for (const color of CAR_COLORS) {
    const s = document.createElement('div')
    s.className = 'swatch'
    s.style.background = `#${color.toString(16).padStart(6, '0')}`
    s.addEventListener('click', () => setCarColor(color, s))
    if (color === carColor) s.classList.add('active')
    swatchEls.push(s)
    container.append(s)
  }
  const custom = document.createElement('input')
  custom.type = 'color'
  custom.value = `#${carColor.toString(16).padStart(6, '0')}`
  custom.title = 'Custom colour'
  custom.addEventListener('input', () => setCarColor(parseInt(custom.value.slice(1), 16), null))
  container.append(custom)
}

buildSwatches(document.getElementById('car-colors'))
buildSwatches(document.getElementById('menu-colors'))

// --- Car & driver selection --------------------------------------------------
// A few tuning presets ("cars") that change engine/top speed live, plus flavour
// drivers (cosmetic until AI opponents exist).
// The original Stunts (1990) roster. `bonus` is the game's car-bonus coefficient
// (higher = harder/slower cars give more score). Tuning is by class (F1/proto
// fastest → trucks slowest). Models reuse our GLBs as visual placeholders until
// the original car models are dropped in. RC Buggy stays first as the default so
// the initial load (base.glb) doesn't race a model swap.
const CARS = [
  { name: 'RC Buggy', url: baseCarUrl, bonus: null, engineForce: 1400, cruiseSpeedKmh: 90, maxSpeedKmh: 140 },
  { name: 'Acura NSX', url: gtrUrl, bonus: 4, engineForce: 1750, cruiseSpeedKmh: 120, maxSpeedKmh: 190 },
  { name: 'Audi Quattro', url: silviaUrl, bonus: 21, engineForce: 1600, cruiseSpeedKmh: 105, maxSpeedKmh: 165 },
  { name: 'Chevrolet Corvette ZR1', url: camaroUrl, bonus: 6, engineForce: 1760, cruiseSpeedKmh: 121, maxSpeedKmh: 192 },
  { name: 'Chevrolet Silverado', url: baseCarUrl, bonus: 32, engineForce: 1450, cruiseSpeedKmh: 85, maxSpeedKmh: 130 },
  { name: 'DAF Siluro Turbo', url: z4Url, bonus: 21, engineForce: 1850, cruiseSpeedKmh: 130, maxSpeedKmh: 210 },
  { name: 'Ferrari GTO', url: ferrariUrl, bonus: 10, engineForce: 1770, cruiseSpeedKmh: 122, maxSpeedKmh: 194 },
  { name: 'Ferrari Testarossa', url: ferrariUrl, bonus: 24, engineForce: 1790, cruiseSpeedKmh: 124, maxSpeedKmh: 198 },
  { name: 'Jaguar XJR9 IMSA', url: gtrUrl, bonus: 3, engineForce: 1860, cruiseSpeedKmh: 133, maxSpeedKmh: 214 },
  { name: 'Lamborghini Countach', url: ferrariUrl, bonus: 14, engineForce: 1790, cruiseSpeedKmh: 124, maxSpeedKmh: 198 },
  { name: 'Lamborghini LM002', url: baseCarUrl, bonus: 36, engineForce: 1500, cruiseSpeedKmh: 88, maxSpeedKmh: 135 },
  { name: 'Lancia Delta Integrale', url: silviaUrl, bonus: 15, engineForce: 1620, cruiseSpeedKmh: 108, maxSpeedKmh: 168 },
  { name: 'Melange XGT-88', url: z4Url, bonus: 4, engineForce: 1850, cruiseSpeedKmh: 130, maxSpeedKmh: 210 },
  { name: 'Porsche 962 IMSA', url: gtrUrl, bonus: 4, engineForce: 1860, cruiseSpeedKmh: 133, maxSpeedKmh: 214 },
  { name: 'Porsche Carrera 4', url: z4Url, bonus: 22, engineForce: 1700, cruiseSpeedKmh: 115, maxSpeedKmh: 180 },
  { name: 'Porsche March Indy', url: baseCarUrl, bonus: -28, engineForce: 1950, cruiseSpeedKmh: 145, maxSpeedKmh: 230 },
  { name: 'Williams Renault FW12', url: baseCarUrl, bonus: -12, engineForce: 1980, cruiseSpeedKmh: 148, maxSpeedKmh: 235 },
]
const DRIVERS = [
  { name: 'Skid Vicious', bio: 'Fearless and fast — takes every jump flat out.' },
  { name: 'Bernie Rubber', bio: 'Wants to be a stunt driver. Squeals the tyres.' },
  { name: 'Herr Otto Partz', bio: 'Precise and unforgiving. Hates mistakes.' },
  { name: 'Joe Stallin', bio: 'Old-school hard-charger. No fear, no brakes.' },
  { name: 'Cherry Chassis', bio: 'Smooth lines, smooth moves. Style points.' },
]
let selectedDriver = DRIVERS[0]

function applyCar(car, swapModel) {
  vehicle.params.engineForce = car.engineForce
  vehicle.params.cruiseSpeedKmh = car.cruiseSpeedKmh
  vehicle.params.maxSpeedKmh = car.maxSpeedKmh
  if (swapModel && car.url) {
    const fullCar = car.url !== baseCarUrl
    vehicle.bodyModelParams.rotationY = car.rotY ?? 0
    // setBodyModel fits the wheels (track/wheelbase) and ride height to the
    // model for full cars; the RC buggy keeps its default layout.
    vehicle.setBodyModel(car.url, { fitWheels: fullCar })
    // The low-poly car GLBs are body shells with no wheels — always keep the
    // raycast wheel visuals; slim car wheels for full cars, chunky RC tyres for
    // the buggy.
    vehicle.setWheelsVisible(true)
    vehicle.setSimpleWheels(fullCar)
  }
}

function buildCarDriverPickers() {
  const carSel = document.getElementById('menu-car')
  const carStats = document.getElementById('menu-car-stats')
  CARS.forEach((c, i) => {
    const o = document.createElement('option')
    o.value = String(i)
    o.textContent = c.name
    carSel.append(o)
  })
  const showCar = (i, swapModel) => {
    const c = CARS[i]
    applyCar(c, swapModel)
    const bonus = c.bonus == null ? '' : ` · bonus ${c.bonus > 0 ? '+' : ''}${c.bonus}%`
    carStats.textContent = `Top ${c.maxSpeedKmh} km/h${bonus}`
  }
  // Init: tuning only — the Vehicle already loads the default (RC Buggy) model.
  carSel.addEventListener('change', (e) => showCar(+e.target.value, true))
  showCar(0, false)

  const driverSel = document.getElementById('menu-driver')
  const driverBio = document.getElementById('menu-driver-bio')
  DRIVERS.forEach((d, i) => {
    const o = document.createElement('option')
    o.value = String(i)
    o.textContent = d.name
    driverSel.append(o)
  })
  const showDriver = (i) => {
    selectedDriver = DRIVERS[i]
    driverBio.textContent = selectedDriver.bio
  }
  driverSel.addEventListener('change', (e) => showDriver(+e.target.value))
  showDriver(0)
}
buildCarDriverPickers()

// --- Start menu + bird's-eye preview -----------------------------------------
const menuEl = document.getElementById('menu')
const openMenuBtn = document.getElementById('open-menu')
const menuTrack = document.getElementById('menu-track')
const menuHorizon = document.getElementById('menu-horizon')
const menuTiles = document.getElementById('menu-tiles')
const panelEl = document.getElementById('panel')
const speedEl = document.getElementById('speed')

function frameBirdview() {
  debug.topView = true
  debug.freeze = false
  debug.topX = 0
  debug.topZ = 0
  debug.topY = 690 // high enough to see the whole 30×30 grid
}

function refreshMenuPreview() {
  if (menuEl.classList.contains('hidden') || !track) return
  frameBirdview()
  menuHorizon.textContent = track.trackFile.horizonName
  menuTiles.textContent = countDrivable(track.trackFile)
}

function openMenu() {
  if (cameraMode === 'cockpit') setCameraMode('chase')
  menuEl.classList.remove('hidden')
  openMenuBtn.classList.add('hidden')
  panelEl.classList.add('hidden')
  speedEl.classList.add('hidden')
  timerEl.classList.add('hidden')
  oppHint.classList.add('hidden')
  document.getElementById('view-btn').classList.add('hidden')
  document.getElementById('wrong-way').classList.add('hidden')
  document.getElementById('position').classList.add('hidden')
  refreshMenuPreview()
}

function startDriving() {
  menuEl.classList.add('hidden')
  openMenuBtn.classList.remove('hidden')
  panelEl.classList.remove('hidden')
  speedEl.classList.remove('hidden')
  timerEl.classList.remove('hidden')
  document.getElementById('view-btn').classList.remove('hidden')
  document.getElementById('position').classList.remove('hidden')
  debug.topView = false
  vehicle.respawn()
  resetTimer()
  resetOpponent() // opponent starts fresh alongside the player
  if (soundOn) initAudio() // this click is the user gesture that unlocks audio
}

menuTrack.addEventListener('change', (event) => {
  loadTrackByUrl(event.target.value)
  trackSelect.value = event.target.value
  refreshMenuPreview()
})
document.getElementById('menu-drive').addEventListener('click', startDriving)
openMenuBtn.addEventListener('click', openMenu)

// --- Chase camera ------------------------------------------------------------

const cameraOffset = new THREE.Vector3(0, 7, -13)
const lookOffset = new THREE.Vector3(0, 2, 6)
const desiredPosition = new THREE.Vector3()
const desiredTarget = new THREE.Vector3()
const currentTarget = new THREE.Vector3()
currentTarget.copy(vehicle.group.position)

// Hood/bumper view: a low, close chase.
const hoodOffset = new THREE.Vector3(0, 3, -5.5)
const hoodLook = new THREE.Vector3(0, 2, 10)

function updateCamera(delta) {
  const chassis = vehicle.group
  const cockpitless = cameraMode === 'hood'
  const posOff = cockpitless ? hoodOffset : cameraOffset
  const lookOff = cockpitless ? hoodLook : lookOffset
  const minLift = cockpitless ? 1.2 : 3
  desiredPosition.copy(posOff).applyQuaternion(chassis.quaternion).add(chassis.position)
  desiredPosition.y = Math.max(desiredPosition.y, chassis.position.y + minLift)
  desiredTarget.copy(lookOff).applyQuaternion(chassis.quaternion).add(chassis.position)

  const posLerp = cockpitless ? 12 : 6
  camera.position.lerp(desiredPosition, 1 - Math.exp(-posLerp * delta))
  currentTarget.lerp(desiredTarget, 1 - Math.exp(-10 * delta))
  camera.lookAt(currentTarget)
}

// --- Camera views (press C or the View button to cycle) ----------------------

const CAMERA_VIEWS = ['chase', 'hood', 'cockpit']
const VIEW_LABELS = { chase: 'Chase', hood: 'Hood', cockpit: 'Cockpit' }
let cameraMode = 'chase'
const cockpitEl = document.getElementById('cockpit')
const viewBtn = document.getElementById('view-btn')
const eyeOffset = new THREE.Vector3(0, 1.5, 0.0) // driver's eyeline inside the car
const cockpitLookOffset = new THREE.Vector3(0, 1.1, 10)
const cockpitEye = new THREE.Vector3()
const cockpitTarget = new THREE.Vector3()

function setCameraMode(mode) {
  cameraMode = mode
  const cockpit = mode === 'cockpit'
  cockpitEl.classList.toggle('hidden', !cockpit)
  vehicle.group.visible = !cockpit // don't render the car body from inside it
  camera.fov = cockpit ? 74 : 60
  camera.updateProjectionMatrix()
  if (viewBtn) viewBtn.textContent = `◉ ${VIEW_LABELS[mode]}`
}

function cycleCameraMode() {
  // No view switching while the start menu (bird's-eye) is up — otherwise the
  // top-down preview stays on and just overlays the cockpit frame.
  if (!menuEl.classList.contains('hidden')) return
  const i = CAMERA_VIEWS.indexOf(cameraMode)
  setCameraMode(CAMERA_VIEWS[(i + 1) % CAMERA_VIEWS.length])
}
if (viewBtn) viewBtn.addEventListener('click', cycleCameraMode)

// --- Wrong-way detection -----------------------------------------------------
// Compare the car's heading with the route's local forward direction; warn when
// driving against the track.
const wrongWayEl = document.getElementById('wrong-way')
const _wwFwd = new THREE.Vector3()

function updateWrongWay() {
  if (!track || !track.route || track.route.length < 3 || resultsOpen ||
      !menuEl.classList.contains('hidden')) {
    wrongWayEl.classList.add('hidden')
    return
  }
  const route = track.route
  const p = vehicle.group.position
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < route.length; i++) {
    const d = route[i].distanceToSquared(p)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  _wwFwd.copy(route[(best + 1) % route.length]).sub(route[best])
  const v = vehicle.chassisBody.velocity
  const speed = Math.hypot(v.x, v.z)
  const dot = v.x * _wwFwd.x + v.z * _wwFwd.z
  const onRoute = bestD < (TILE * 1.5) * (TILE * 1.5)
  const wrong = onRoute && speed > 3 && dot < 0
  wrongWayEl.classList.toggle('hidden', !wrong)
}

function updateCockpit(delta) {
  const chassis = vehicle.group
  cockpitEye.copy(eyeOffset).applyQuaternion(chassis.quaternion).add(chassis.position)
  cockpitTarget.copy(cockpitLookOffset).applyQuaternion(chassis.quaternion).add(chassis.position)
  camera.position.lerp(cockpitEye, 1 - Math.exp(-35 * delta))
  camera.lookAt(cockpitTarget)
}

// --- Windshield crack on a hard crash ----------------------------------------

const crackEl = document.getElementById('crack')
const SVG_NS = 'http://www.w3.org/2000/svg'
let prevSpeed = 0
let crackTimer = 0

function addCrackLine(x1, y1, x2, y2, w) {
  const l = document.createElementNS(SVG_NS, 'line')
  l.setAttribute('x1', x1)
  l.setAttribute('y1', y1)
  l.setAttribute('x2', x2)
  l.setAttribute('y2', y2)
  l.setAttribute('stroke-width', w)
  crackEl.appendChild(l)
}

function triggerCrack() {
  while (crackEl.firstChild) crackEl.removeChild(crackEl.firstChild)
  // Draw in pixel space matched to the viewport (robust; avoids non-uniform
  // viewBox stroke bugs).
  const W = window.innerWidth
  const H = window.innerHeight
  crackEl.setAttribute('viewBox', `0 0 ${W} ${H}`)
  const cx = W * (0.35 + Math.random() * 0.3)
  const cy = H * (0.28 + Math.random() * 0.26)
  const maxLen = Math.min(W, H)
  const spokes = 12 + Math.floor(Math.random() * 6)
  const tips = []
  for (let i = 0; i < spokes; i++) {
    const ang = (i / spokes) * Math.PI * 2 + (Math.random() - 0.5) * 0.3
    const len = maxLen * (0.35 + Math.random() * 0.6)
    const steps = 3 + Math.floor(Math.random() * 3)
    let px = cx
    let py = cy
    for (let s = 1; s <= steps; s++) {
      const r = (len * s) / steps
      const j = (Math.random() - 0.5) * maxLen * 0.07
      const nx = cx + Math.cos(ang) * r + Math.cos(ang + 1.57) * j
      const ny = cy + Math.sin(ang) * r + Math.sin(ang + 1.57) * j
      addCrackLine(px, py, nx, ny, 1.4 + Math.random() * 1.8)
      px = nx
      py = ny
    }
    tips.push([cx + Math.cos(ang) * len * 0.55, cy + Math.sin(ang) * len * 0.55])
  }
  // Concentric web connecting adjacent spokes.
  for (let i = 0; i < tips.length; i++) {
    if (Math.random() < 0.65) {
      const a = tips[i]
      const b = tips[(i + 1) % tips.length]
      addCrackLine(a[0], a[1], b[0], b[1], 1.1)
    }
  }
  crackEl.classList.add('show')
  crackTimer = 2.6
  playThud()
}

function clearCrack() {
  crackEl.classList.remove('show')
  crackTimer = 0
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyC') cycleCameraMode()
  if (event.code === 'KeyR') clearCrack()
})

// --- Debug: top-down view ----------------------------------------------------
// Exposes the scene and a persistent top-down camera toggle so track layout /
// piece orientation can be inspected (and screenshotted) from above.
const debug = { topView: false, topY: 820, topX: 0, topZ: 0 }
const sceneFog = scene.fog
function updateTopView() {
  camera.position.set(debug.topX, debug.topY, debug.topZ + 0.01)
  camera.lookAt(debug.topX, 0, debug.topZ)
}
window.__stunts = {
  scene, camera, renderer, vehicle, debug, loadTrack,
  forceCrack() { triggerCrack(); crackTimer = 9999 },
  setCameraMode,
  get track() { return track },
}

// --- Loop --------------------------------------------------------------------

const FIXED_STEP = 1 / 60
let lastTime = performance.now()
const speedValue = document.getElementById('speed-value')
const cockpitSpeed = document.getElementById('cockpit-speed')

function tick() {
  const now = performance.now()
  const delta = Math.min((now - lastTime) / 1000, 0.1)
  lastTime = now

  // Freeze the whole simulation while the results screen is up (race over) —
  // the car, opponent, physics and clock all stop.
  if (!resultsOpen) {
    physicsWorld.step(FIXED_STEP, delta, 3)
    vehicle.update(delta)
    updateLoopAssist()
    updateOpponent(delta)
  }
  if (debug.topView) updateTopView()
  else if (debug.freeze) {
    // manual/frozen camera — leave it where it is
  } else if (cameraMode === 'cockpit') updateCockpit(delta)
  else updateCamera(delta)
  // Fog would hide the whole track from the high top-down camera.
  scene.fog = debug.topView ? null : sceneFog

  // Keep the sun/shadow frustum centred on the car.
  sun.position.set(
    vehicle.group.position.x + 60,
    vehicle.group.position.y + 90,
    vehicle.group.position.z + 30
  )
  sun.target.position.copy(vehicle.group.position)
  sun.target.updateMatrixWorld()

  const roundedSpeed = Math.round(vehicle.speedKmh)
  speedValue.textContent = roundedSpeed
  cockpitSpeed.textContent = roundedSpeed
  updateWrongWay()
  const driving =
    vehicle.input.forward || vehicle.input.backward || Math.abs(vehicle.input.throttleAxis) > 0.05
  updateTimer(delta, driving, vehicle.group.position)
  updatePosition()
  updateAudio(driving)

  // Hard-crash detection: a big one-frame speed drop cracks the windshield.
  const spd = vehicle.speedKmh
  if (prevSpeed - spd > 30 && prevSpeed > 35) triggerCrack()
  prevSpeed = spd
  if (crackTimer > 0) {
    crackTimer -= delta
    if (crackTimer <= 0) clearCrack()
  }

  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}

tick()
openMenu() // start on the menu with a bird's-eye preview
