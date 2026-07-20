import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import GUI from 'lil-gui'
import { createPostProcessing, DEFAULT_POST_PARAMS } from '../engine/postProcessing.js'
import { createPhysicsDebug } from '../engine/physicsDebug.js'
import { createShadowController } from '../engine/shadow.js'
import { createGamepadInput } from '../engine/gamepad.js'
import { createCameraController } from './camera.js'
import { createStuntsScene } from './scene.js'
import {
  buildVehicleSections,
  buildPostSection,
  buildModelSections,
  buildTireMarksSection,
} from '../ui/tuning/sections.js'
import { createColorSwatches } from '../ui/molecules/ColorSwatches.js'
import { createResultsScreen } from '../ui/organisms/ResultsScreen.js'
import { createHud } from '../ui/organisms/Hud.js'
import { createMenu } from '../ui/organisms/Menu.js'
import { createCockpit } from '../ui/organisms/Cockpit.js'
import { createCrashOverlay } from '../ui/organisms/CrashOverlay.js'

import '../ui/styles/tokens.css'
import '../ui/styles/base.css'
import '../ui/styles/controls.css'
import '../ui/styles/panel.css'
import '../ui/styles/hud.css'
import '../ui/styles/menu.css'
import '../ui/styles/cockpit.css'
import '../ui/styles/results.css'

import {
  Vehicle,
  DEFAULT_PARAMS,
  DEFAULT_BODY_MODEL_PARAMS,
  DEFAULT_WHEEL_MODEL_PARAMS,
  DEFAULT_REFLECTION_PARAMS,
  DEFAULT_TIRE_MARK_PARAMS,
} from '../Vehicle.js'
import { TrackFile, createDemoTrackFile } from './TrackFile.js'
import { describeElement } from './trackElements.js'
import { StuntsTrack, TILE } from './StuntsTrack.js'
import { GRID } from './TrackFile.js'
import { TRACK_NAMES } from './trackNames.js'

// Selectable car models (dropped in src/assets, imported as URLs).
import baseCarUrl from '../assets/base.glb?url'
import mustangUrl from '../assets/low_poly_ford_mustang.glb?url'
import gtrUrl from '../assets/low_poly_nissan_gtr.glb?url'
import camaroUrl from '../assets/low_poly_chevrolet_camaro.glb?url'
import ferrariUrl from '../assets/low_poly_ferrari_br20.glb?url'
import z4Url from '../assets/low_poly_bmw_z4_coupe.glb?url'
import silviaUrl from '../assets/low_poly_nissan_silvia_s15.glb?url'

// --- Renderer, scene & lights ------------------------------------------------

const { renderer, scene, camera, hemi, sun } = createStuntsScene(document.getElementById('app'))

// --- Post-processing ---------------------------------------------------------
// Same chain and defaults as the arcade playground (src/main.js): a color-grade
// pass (grade + vignette + chromatic aberration + film noise + boost wind
// streaks) plus optional GTAO. The Stunts camera's far plane (4000) is kept.

const DEFAULT_CAMERA_PARAMS = {
  fov: 60,
  far: 4000,
}
const cameraParams = { ...DEFAULT_CAMERA_PARAMS }
let cameraBoostBlend = 0

const postParams = { ...DEFAULT_POST_PARAMS }
let postBoostBlend = 0
let windLinesBlend = 0

const { composer, colorGradePass, applyPostParams, setSize: setPostSize } =
  createPostProcessing(renderer, scene, camera, postParams)

function applyCameraParams(fovOverride = cameraParams.fov) {
  camera.fov = fovOverride
  camera.far = cameraParams.far
  camera.updateProjectionMatrix()
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  setPostSize(window.innerWidth, window.innerHeight)
})

// --- Physics -----------------------------------------------------------------

const physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) })
physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld)
physicsWorld.allowSleep = true
physicsWorld.defaultContactMaterial.friction = 0.3

// --- Vehicle -----------------------------------------------------------------

const vehicle = new Vehicle(scene, physicsWorld)

// sunX/Y/Z are the sun's offset from the car (the shadow frustum follows the
// car each frame — see tick()).
const DEFAULT_LIGHTING_PARAMS = {
  ambientIntensity: hemi.intensity,
  sunIntensity: sun.intensity,
}
const { shadowParams, DEFAULT_SHADOW_PARAMS, applyShadowParams, follow: followShadow } =
  createShadowController(sun, { sunX: 60, sunY: 90, sunZ: 30, shadowCameraSize: TILE * 4 })

const physicsDebug = createPhysicsDebug(scene, physicsWorld, vehicle)

// Overlays built in JS (populated/wired by the game below).
const menu = createMenu()
const cockpitOverlay = createCockpit()
const crash = createCrashOverlay()
const gamepadInput = createGamepadInput(vehicle)

// --- AI opponent -------------------------------------------------------------
// A ghost car that drives the track's route (see StuntsTrack._buildRoute). It's
// not physics-driven — it advances along the ordered tile-centre path at a fixed
// pace and orients to its heading, so it reliably completes the circuit.
const hud = createHud()

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
  hud.setOpponentHint(near)
}

// --- Race position (you vs the opponent) -------------------------------------
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
  hud.setPosition(best >= opponent.idx ? '1st' : '2nd')
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
  if (resultsScreen.isOpen) {
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

// Single source of truth for sound on/off, shared by the 🔊 button and the
// tuning panel's Sound toggle (kept in sync via soundController).
const audioParams = { sound: soundOn }
let soundController = null

function setSound(on) {
  soundOn = on
  audioParams.sound = on
  soundBtn.textContent = on ? '🔊' : '🔇'
  if (on) initAudio()
  else if (engineGain) engineGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05)
  soundController?.updateDisplay()
}

soundBtn.addEventListener('click', () => {
  setSound(!soundOn)
  // Drop focus so Space/Enter (jump) doesn't re-trigger this button and flip
  // the sound back on — the bug that made sound impossible to turn off.
  soundBtn.blur()
})

// --- Run / lap timer ---------------------------------------------------------
// Starts on the player's first throttle input (not spawn drift) and resets on
// respawn (R) or track load. On tracks with a start/finish tile it times laps:
// the big readout is the current lap, and it records the best lap and lap count
// each time the car crosses the start tile. Tracks without a start tile fall
// back to a plain elapsed-time stopwatch.
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
  hud.setIdle(true)
  hud.setTimer('0:00.000')
  hud.setLapCount(1)
  hud.setBestLap('—')
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
  if (resultsScreen.isOpen) return // frozen while the results screen is up
  if (!timing && driving) {
    timing = true
    hud.setIdle(false)
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
        hud.setBestLap(formatTime(bestLap))
      }
      lapCount++
      hud.setLapCount(lapCount)
      finishLap(lapElapsed)
      lapStart = runTime
      resetLapStats()
    }
    wasOnStart = onStart
    hud.setTimer(formatTime(runTime - lapStart))
  } else {
    hud.setTimer(formatTime(runTime))
  }
}

// R respawns the car (handled inside Vehicle); mirror it here to reset the clock.
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyR') resetTimer()
})

// --- Results / fastest times -------------------------------------------------
const resultsScreen = createResultsScreen()

function finishLap(lapSeconds) {
  const code = document.getElementById('track-name').textContent
  const key = `stunts-times:${code}`
  let times = []
  try {
    times = JSON.parse(localStorage.getItem(key)) || []
  } catch {
    times = []
  }
  times.push({ t: lapSeconds, c: carColors.color })
  times.sort((a, b) => a.t - b.t)
  times = times.slice(0, 8)
  try {
    localStorage.setItem(key, JSON.stringify(times))
  } catch {
    /* storage may be unavailable; results still show */
  }

  resultsScreen.show({
    trackName: code,
    entries: times.map((e, i) => {
      const mine = Math.abs(e.t - lapSeconds) < 0.0005
      return { rank: i + 1, label: mine ? 'You' : '···', time: formatTime(e.t), mine }
    }),
    lapTime: formatTime(lapSeconds),
    topSpeed: Math.round(lapTop),
    avgSpeed: Math.round(lapSpeedSum / Math.max(1, lapSpeedN)),
    jumps: lapJumps,
  })
}

// --- Loop assist -------------------------------------------------------------
// A raycast vehicle can't complete a vertical loop on physics alone (it rams the
// curving surface and bleeds speed). While the car is on a loop and moving fast,
// press it toward the loop surface (centripetal help, scaled up toward the top)
// and align its roof to the inward normal so the wheels stay on the ribbon.
const UP_VEC = new CANNON.Vec3(0, 1, 0)
// A raycast vehicle can't reliably drive a vertical loop on physics alone, so
// once the car enters a loop's base with enough forward speed it's "railed":
// animated around the circle (position + orientation) and released, upright and
// moving forward, at the exit. Guarantees the loop always completes.
const LOOP_UP = new CANNON.Vec3(0, 1, 0)
let loopRide = null // { L, alpha, speed }
const _lFwd = new THREE.Vector3()
const _lUp = new THREE.Vector3()
const _lRgt = new THREE.Vector3()
const _lMat = new THREE.Matrix4()
const _lQuat = new THREE.Quaternion()

function updateLoopAssist(delta) {
  const b = vehicle.chassisBody

  if (loopRide) {
    const L = loopRide.L
    loopRide.alpha += (loopRide.speed / L.RL) * delta
    if (loopRide.alpha >= Math.PI * 2) {
      // Release at the base, upright, moving forward out of the loop.
      b.position.set(L.cx, L.cy - L.RL + 1.2, L.cz)
      b.velocity.set(L.tdx * loopRide.speed, 0, L.tdz * loopRide.speed)
      b.angularVelocity.set(0, 0, 0)
      b.quaternion.setFromAxisAngle(LOOP_UP, Math.atan2(L.tdx, L.tdz))
      loopRide = null
      return
    }
    const a = loopRide.alpha
    // Point on the loop centreline; the circle centre is at (cx, cy, cz).
    const px = L.cx + L.tdx * L.RL * Math.sin(a)
    const py = L.cy - L.RL * Math.cos(a)
    const pz = L.cz + L.tdz * L.RL * Math.sin(a)
    const nx = (L.cx - px) / L.RL // inward normal (toward centre) = car's up
    const ny = (L.cy - py) / L.RL
    const nz = (L.cz - pz) / L.RL
    b.position.set(px + nx * 1.4, py + ny * 1.4, pz + nz * 1.4) // ride just inside
    _lFwd.set(L.tdx * Math.cos(a), Math.sin(a), L.tdz * Math.cos(a)).normalize() // tangent
    _lUp.set(nx, ny, nz)
    _lRgt.crossVectors(_lUp, _lFwd).normalize()
    _lMat.makeBasis(_lRgt, _lUp, _lFwd)
    _lQuat.setFromRotationMatrix(_lMat)
    b.quaternion.set(_lQuat.x, _lQuat.y, _lQuat.z, _lQuat.w)
    b.velocity.set(_lFwd.x * loopRide.speed, _lFwd.y * loopRide.speed, _lFwd.z * loopRide.speed)
    b.angularVelocity.set(0, 0, 0)
    return
  }

  // Not riding: catch the car at a loop base moving forward fast enough.
  if (!track || !track.loops.length) return
  const P = b.position
  const vx = b.velocity.x
  const vz = b.velocity.z
  for (const L of track.loops) {
    if (P.y > 4) continue
    if (Math.hypot(P.x - L.cx, P.z - L.cz) > TILE * 0.85) continue
    const along = vx * L.tdx + vz * L.tdz // forward speed into the loop
    if (along > 15) {
      loopRide = { L, alpha: 0.06, speed: Math.max(along, 42) }
      return
    }
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

  // Spawn on the first straight tile along the route, facing the racing
  // direction — never wedged on a corner apex (see StuntsTrack.getSpawn).
  const spawn = track.getSpawn()
  vehicle.spawnPosition.set(spawn.position.x, spawn.position.y + 2, spawn.position.z)
  vehicle.spawnQuaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spawn.yaw)
  vehicle.respawn()

  document.getElementById('track-name').textContent = TRACK_NAMES[name] ?? name
  document.getElementById('horizon-name').textContent = trackFile.horizonName
  document.getElementById('tile-count').textContent = countDrivable(trackFile)
  resetTimer()
  resetOpponent()
  // Show lap UI only when the track has a start/finish tile to time against.
  hud.showLapInfo(track.hasStart)
  hud.setTimerLabel(track.hasStart ? 'LAP TIME' : 'TIME')
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

// The .TRK format stores no track name — only the 30x30 grid. Files are saved
// under their raceforkicks code (r4k0…), so we map codes to the real titles
// (see trackNames.js) and label each entry "Title · N tiles", grouped by
// horizon and sorted by title.
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
    const trackName = (code) => TRACK_NAMES[code] ?? code
    const list = byHorizon
      .get(horizon)
      .sort((a, b) => trackName(a.code).localeCompare(trackName(b.code), undefined, { numeric: true }))
    for (const { code, url, tiles } of list) {
      const option = document.createElement('option')
      option.value = url
      option.textContent = `${trackName(code)} · ${tiles} tiles`
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
const carColors = createColorSwatches({
  initial: 0xef4444,
  onChange: (color) => vehicle.setBodyColor(color),
})
carColors.mount(document.getElementById('car-colors'))
carColors.mount(menu.colorsContainer)

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
  const carSel = menu.carSelect
  const carStats = menu.carStatsEl
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

  const driverSel = menu.driverSelect
  const driverBio = menu.driverBioEl
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
const menuEl = menu.root
const openMenuBtn = menu.openButton
const menuTrack = menu.trackSelect
const menuHorizon = menu.horizonEl
const menuTiles = menu.tilesEl
const panelEl = document.getElementById('panel')

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
  if (cameraController.mode === 'cockpit') cameraController.setMode('chase')
  menuEl.classList.remove('hidden')
  openMenuBtn.classList.add('hidden')
  panelEl.classList.add('hidden')
  hud.setVisible(false)
  document.getElementById('view-btn').classList.add('hidden')
  refreshMenuPreview()
}

function startDriving() {
  menuEl.classList.add('hidden')
  openMenuBtn.classList.remove('hidden')
  panelEl.classList.remove('hidden')
  hud.setVisible(true)
  document.getElementById('view-btn').classList.remove('hidden')
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
menu.driveButton.addEventListener('click', startDriving)
openMenuBtn.addEventListener('click', openMenu)

// --- Camera (chase / hood / cockpit) -----------------------------------------

const cameraController = createCameraController({
  camera,
  vehicle,
  cockpitOverlay,
  viewButton: document.getElementById('view-btn'),
  isMenuOpen: () => !menuEl.classList.contains('hidden'),
})

// --- Wrong-way detection -----------------------------------------------------
// Compare the car's heading with the route's local forward direction; warn when
// driving against the track.
const _wwFwd = new THREE.Vector3()

function updateWrongWay() {
  if (!track || !track.route || track.route.length < 3 || resultsScreen.isOpen ||
      !menuEl.classList.contains('hidden')) {
    hud.setWrongWay(false)
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
  hud.setWrongWay(wrong)
}


// --- Windshield crack on a hard crash ----------------------------------------

let prevSpeed = 0

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyC') cameraController.cycle()
  if (event.code === 'KeyR') crash.clear()
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
  forceCrack() { crash.trigger(9999) },
  setCameraMode: cameraController.setMode,
  get track() { return track },
}

// --- Tuning GUI --------------------------------------------------------------
// Mirrors the arcade playground's panel (src/main.js). Hidden by default; press
// "." to toggle. Groups that don't apply to the Stunts scene (environment
// height, teleporter) are omitted.

const gui = new GUI({ title: 'Vehicle Tuning' })
const p = vehicle.params
const rp = vehicle.reflectionParams
const tm = vehicle.tireMarkParams
const bm = vehicle.bodyModelParams
const wm = vehicle.wheelModelParams
const performanceParams = { fps: 0 }

const vehicleFolder = gui.addFolder('Vehicle')
const cameraFolder = gui.addFolder('Camera')
const worldFolder = gui.addFolder('World')
const effectsFolder = gui.addFolder('Effects')
const modelsFolder = gui.addFolder('Models')
const debugFolder = gui.addFolder('Debug')

const fpsController = debugFolder.add(performanceParams, 'fps').name('FPS').listen()

let guiVisible = false
gui.domElement.style.display = 'none'
window.addEventListener('keydown', (event) => {
  const target = event.target
  const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
  if (event.code !== 'Period' || event.repeat || isTyping) return
  guiVisible = !guiVisible
  gui.domElement.style.display = guiVisible ? '' : 'none'
  event.preventDefault()
})

cameraFolder.add(cameraParams, 'fov', 30, 100, 1).name('FOV').onChange(() => applyCameraParams())
cameraFolder.add(cameraParams, 'far', 500, 20000, 100).name('Far clipping').onChange(() => applyCameraParams())

const lightingFolder = worldFolder.addFolder('Lighting & Shadows')
lightingFolder.close()
lightingFolder.add(hemi, 'intensity', 0, 2, 0.01).name('Ambient light')
lightingFolder.add(sun, 'intensity', 0, 5, 0.01).name('Sun light')
lightingFolder.add(shadowParams, 'sunX', -100, 100, 1).name('Sun X').onChange(applyShadowParams)
lightingFolder.add(shadowParams, 'sunY', 5, 200, 1).name('Sun Y').onChange(applyShadowParams)
lightingFolder.add(shadowParams, 'sunZ', -100, 100, 1).name('Sun Z').onChange(applyShadowParams)
lightingFolder
  .add(shadowParams, 'shadowMapSize', [512, 1024, 2048, 4096])
  .name('Shadow map')
  .onChange((value) => {
    shadowParams.shadowMapSize = Number(value)
    applyShadowParams()
  })
lightingFolder.add(shadowParams, 'shadowCameraSize', 20, 400, 1).name('Shadow area').onChange(applyShadowParams)
lightingFolder.add(shadowParams, 'shadowBias', -0.01, 0.01, 0.0001).name('Shadow bias').onChange(applyShadowParams)
lightingFolder.add(shadowParams, 'shadowNormalBias', 0, 0.1, 0.001).name('Normal bias').onChange(applyShadowParams)
lightingFolder.add(shadowParams, 'shadowRadius', 0, 10, 0.1).name('Shadow softness').onChange(applyShadowParams)
lightingFolder.add(rp, 'glbReflectionIntensity', 0, 1, 0.01).name('GLB reflection').onChange(() => vehicle.applyReflectionParams())

buildPostSection(effectsFolder, postParams, applyPostParams)
buildModelSections(modelsFolder, bm, wm, vehicle)
buildTireMarksSection(effectsFolder, tm, vehicle)
buildVehicleSections(vehicleFolder, p, vehicle)

debugFolder.add(vehicle.debugParams, 'physics').name('Show physics colliders').onChange((visible) => physicsDebug.setVisible(visible))
debugFolder.add(debug, 'topView').name('Top-down view')

soundController = gui.add(audioParams, 'sound').name('Sound').onChange(setSound)

const actions = {
  respawn: () => vehicle.respawn(),
  resetParams: () => {
    Object.assign(p, DEFAULT_PARAMS)
    Object.assign(bm, DEFAULT_BODY_MODEL_PARAMS)
    Object.assign(wm, DEFAULT_WHEEL_MODEL_PARAMS)
    Object.assign(rp, DEFAULT_REFLECTION_PARAMS)
    Object.assign(tm, DEFAULT_TIRE_MARK_PARAMS)
    Object.assign(postParams, DEFAULT_POST_PARAMS)
    Object.assign(cameraParams, DEFAULT_CAMERA_PARAMS)
    Object.assign(shadowParams, DEFAULT_SHADOW_PARAMS)
    hemi.intensity = DEFAULT_LIGHTING_PARAMS.ambientIntensity
    sun.intensity = DEFAULT_LIGHTING_PARAMS.sunIntensity
    postBoostBlend = 0
    cameraBoostBlend = 0
    windLinesBlend = 0
    colorGradePass.uniforms.windLines.value = 0
    applyPostParams()
    applyCameraParams()
    applyShadowParams()
    vehicle.applyWheelParams()
    vehicle.applyChassisParams()
    vehicle.applyBodyModelParams()
    vehicle.applyWheelModelParams()
    vehicle.applyReflectionParams()
    vehicle.applyTireMarkParams()
    vehicle.clearTireMarks()
    physicsDebug.setVisible(vehicle.debugParams.physics)
    gui.controllersRecursive().forEach((c) => c.updateDisplay())
  },
}
gui.add(actions, 'respawn').name('Respawn car (R)')
gui.add(actions, 'resetParams').name('Reset to defaults')

gui.foldersRecursive().forEach((folder) => folder.close())
gui.close()

// --- Loop --------------------------------------------------------------------

const FIXED_STEP = 1 / 60
let lastTime = performance.now()
let fpsElapsed = 0
let fpsFrames = 0

function tick() {
  const now = performance.now()
  const delta = Math.min((now - lastTime) / 1000, 0.1)
  lastTime = now
  fpsElapsed += delta
  fpsFrames += 1
  if (fpsElapsed >= 0.25) {
    performanceParams.fps = Math.round(fpsFrames / fpsElapsed)
    fpsController.updateDisplay()
    fpsElapsed = 0
    fpsFrames = 0
  }

  // Freeze the whole simulation while the results screen is up (race over) —
  // the car, opponent, physics and clock all stop.
  if (!resultsScreen.isOpen) {
    gamepadInput.poll()
    physicsWorld.step(FIXED_STEP, delta, 3)
    vehicle.update(delta)
    updateLoopAssist(delta)
    updateOpponent(delta)
  }
  if (debug.topView) updateTopView()
  else if (debug.freeze) {
    // manual/frozen camera — leave it where it is
  } else cameraController.update(delta)
  // Fog would hide the whole track from the high top-down camera.
  scene.fog = debug.topView ? null : sceneFog

  // Keep the sun/shadow frustum centred on the car.
  followShadow(vehicle.group.position.x, vehicle.group.position.z)

  const roundedSpeed = Math.round(vehicle.speedKmh)
  hud.setSpeed(roundedSpeed)
  cockpitOverlay.setSpeed(roundedSpeed)
  updateWrongWay()
  const driving =
    vehicle.input.forward || vehicle.input.backward || Math.abs(vehicle.input.throttleAxis) > 0.05
  updateTimer(delta, driving, vehicle.group.position)
  updatePosition()
  updateAudio(driving)

  // Hard-crash detection: a big one-frame speed drop cracks the windshield.
  const spd = vehicle.speedKmh
  if (prevSpeed - spd > 30 && prevSpeed > 35) {
    crash.trigger()
    playThud()
  }
  prevSpeed = spd
  crash.update(delta)

  // Boost-driven camera/post blends, then render through the composer.
  const boosting = vehicle.input.boost || vehicle.input.gamepadBoost
  const boostTarget = boosting ? 1 : 0
  postBoostBlend = THREE.MathUtils.lerp(postBoostBlend, boostTarget, 1 - Math.exp(-8 * delta))
  cameraBoostBlend = THREE.MathUtils.lerp(cameraBoostBlend, boostTarget, 1 - Math.exp(-7 * delta))
  const windLinesTarget = boosting && vehicle.speedKmh > postParams.windLinesMinSpeedKmh ? 1 : 0
  windLinesBlend = THREE.MathUtils.lerp(windLinesBlend, windLinesTarget, 1 - Math.exp(-5 * delta))
  colorGradePass.uniforms.windLines.value = windLinesBlend * postParams.windLinesStrength
  // Don't fight the fixed top-down debug camera with the boost FOV kick.
  const baseFov = debug.topView ? cameraParams.fov : THREE.MathUtils.lerp(cameraParams.fov, 72, cameraBoostBlend)
  applyCameraParams(baseFov)
  applyPostParams(postBoostBlend)
  colorGradePass.uniforms.time.value = now * 0.001
  physicsDebug.update()

  if (postParams.enabled) {
    composer.render()
  } else {
    renderer.render(scene, camera)
  }
  requestAnimationFrame(tick)
}

tick()
openMenu() // start on the menu with a bird's-eye preview
