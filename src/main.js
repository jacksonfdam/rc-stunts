import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import GUI from 'lil-gui'
import { createPostProcessing, DEFAULT_POST_PARAMS } from './engine/postProcessing.js'
import { createPhysicsDebug } from './engine/physicsDebug.js'
import { createShadowController } from './engine/shadow.js'
import { createGamepadInput, shapeAxis } from './engine/gamepad.js'
import { createOrbitCamera } from './camera.js'
import {
  buildVehicleSections,
  buildPostSection,
  buildModelSections,
  buildTireMarksSection,
} from './ui/tuning/sections.js'
import {
  Vehicle,
  DEFAULT_PARAMS,
  DEFAULT_BODY_MODEL_PARAMS,
  DEFAULT_WHEEL_MODEL_PARAMS,
  DEFAULT_REFLECTION_PARAMS,
  DEFAULT_TIRE_MARK_PARAMS,
} from './Vehicle.js'
import { World, DEFAULT_ENVIRONMENT_PARAMS } from './World.js'
import houseReflectionUrl from './assets/reflection.jpg?url'

// --- Renderer & scene -------------------------------------------------------

const container = document.getElementById('app')

// MSAA on the default framebuffer only applies when post-processing is off;
// the composer path gets its own multisampled render targets below.
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
// Plain PCF so sun.shadow.radius (the "Shadow softness" slider) applies
renderer.shadowMap.type = THREE.PCFShadowMap
container.appendChild(renderer.domElement)

const scene = new THREE.Scene()

function createSoftOutdoorEnvironmentMaps(renderer) {
  const makeFace = (topColor, bottomColor) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, topColor)
    gradient.addColorStop(0.55, '#9fc2d4')
    gradient.addColorStop(1, bottomColor)
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
    return canvas
  }

  const cubeTexture = new THREE.CubeTexture([
    makeFace('#6687a0', '#586446'), // +x
    makeFace('#6c8ca4', '#515d3f'), // -x
    makeFace('#8daec5', '#708b9c'), // +y
    makeFace('#4f5a3d', '#303629'), // -y
    makeFace('#6689a1', '#586443'), // +z
    makeFace('#607f96', '#4f5b3d'), // -z
  ])
  cubeTexture.colorSpace = THREE.SRGBColorSpace
  cubeTexture.needsUpdate = true

  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  const reflectionMap = pmremGenerator.fromCubemap(cubeTexture).texture
  pmremGenerator.dispose()
  return {
    backgroundMap: cubeTexture,
    reflectionMap,
  }
}

async function createImageReflectionMap(renderer, url) {
  const texture = await new THREE.TextureLoader().loadAsync(url)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.mapping = THREE.EquirectangularReflectionMapping

  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  const reflectionMap = pmremGenerator.fromEquirectangular(texture).texture
  pmremGenerator.dispose()
  texture.dispose()
  return reflectionMap
}

// Generated reflection map for GLB materials only. Keeping it off
// scene.environment prevents the whole world from looking over-lit/washed out.
const { backgroundMap: outdoorBackgroundMap, reflectionMap: glbReflectionMap } =
  createSoftOutdoorEnvironmentMaps(renderer)
const houseReflectionMap = await createImageReflectionMap(renderer, houseReflectionUrl)
scene.background = outdoorBackgroundMap

const DEFAULT_CAMERA_PARAMS = {
  fov: 60,
  far: 10000,
}
const cameraParams = { ...DEFAULT_CAMERA_PARAMS }
let cameraBoostBlend = 0
const camera = new THREE.PerspectiveCamera(
  cameraParams.fov,
  window.innerWidth / window.innerHeight,
  0.1,
  cameraParams.far
)
camera.position.set(0, 6, -10)

const postParams = { ...DEFAULT_POST_PARAMS }
let postBoostBlend = 0
let windLinesBlend = 0
renderer.toneMapping = THREE.ACESFilmicToneMapping

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

// --- Game objects ------------------------------------------------------------

const world = new World(scene, physicsWorld, houseReflectionMap)
await world.ready
const vehicle = new Vehicle(scene, physicsWorld, glbReflectionMap)
const DEFAULT_LIGHTING_PARAMS = {
  ambientIntensity: world.hemi.intensity,
  sunIntensity: world.sun.intensity,
}

const { shadowParams, DEFAULT_SHADOW_PARAMS, applyShadowParams, follow: followShadow } =
  createShadowController(world.sun, { shadowCameraSize: 80 })

const physicsDebug = createPhysicsDebug(scene, physicsWorld, vehicle)
physicsDebug.setVisible(vehicle.debugParams.physics)

// --- Chase camera ------------------------------------------------------------

const orbitCamera = createOrbitCamera({ renderer, camera, vehicle })

// --- Transporter --------------------------------------------------------------

const DEFAULT_TRANSPORTER_PARAMS = {
  enabled: true,
  radius: 4,
  cooldown: 3.6,
  opacity: 0.55,
  ax: -37.7,
  ay: 15.6,
  az: 103.7,
  bx: -25,
  by: 39.1,
  bz: 111.5,
}
const transporterParams = { ...DEFAULT_TRANSPORTER_PARAMS }
let transporterCooldown = 0

const transporterMaterialA = new THREE.MeshBasicMaterial({
  color: 0x38bdf8,
  transparent: true,
  opacity: transporterParams.opacity,
  depthWrite: false,
})
const transporterMaterialB = new THREE.MeshBasicMaterial({
  color: 0xf472b6,
  transparent: true,
  opacity: transporterParams.opacity,
  depthWrite: false,
})
const transporterA = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 64), transporterMaterialA)
const transporterB = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 64), transporterMaterialB)
transporterA.rotation.x = -Math.PI / 2
transporterB.rotation.x = -Math.PI / 2
scene.add(transporterA, transporterB)

function applyTransporterParams() {
  transporterA.visible = transporterParams.enabled
  transporterB.visible = transporterParams.enabled
  transporterA.position.set(transporterParams.ax, transporterParams.ay, transporterParams.az)
  transporterB.position.set(transporterParams.bx, transporterParams.by, transporterParams.bz)
  transporterA.scale.setScalar(transporterParams.radius)
  transporterB.scale.setScalar(transporterParams.radius)
  transporterMaterialA.opacity = transporterParams.opacity
  transporterMaterialB.opacity = transporterParams.opacity
}

function teleportVehicleTo(x, y, z) {
  vehicle.chassisBody.position.set(x, y, z)
  vehicle.chassisBody.interpolatedPosition.set(x, y, z)
  vehicle.chassisBody.velocity.setZero()
  vehicle.chassisBody.angularVelocity.setZero()
  vehicle.clearTireMarks()
}

function updateTransporter(delta) {
  transporterCooldown = Math.max(0, transporterCooldown - delta)
  if (!transporterParams.enabled || transporterCooldown > 0) return

  const body = vehicle.chassisBody
  const radiusSq = transporterParams.radius * transporterParams.radius
  const dxA = body.position.x - transporterParams.ax
  const dyA = body.position.y - transporterParams.ay
  const dzA = body.position.z - transporterParams.az
  const dxB = body.position.x - transporterParams.bx
  const dyB = body.position.y - transporterParams.by
  const dzB = body.position.z - transporterParams.bz

  if (dxA * dxA + dyA * dyA + dzA * dzA <= radiusSq) {
    teleportVehicleTo(transporterParams.bx, transporterParams.by, transporterParams.bz)
    transporterCooldown = transporterParams.cooldown
  } else if (dxB * dxB + dyB * dyB + dzB * dzB <= radiusSq) {
    teleportVehicleTo(transporterParams.ax, transporterParams.ay, transporterParams.az)
    transporterCooldown = transporterParams.cooldown
  }
}

applyTransporterParams()

// --- Tuning GUI ---------------------------------------------------------------

const gui = new GUI({ title: 'Vehicle Tuning' })
const p = vehicle.params
const rp = vehicle.reflectionParams
const tm = vehicle.tireMarkParams
const bm = vehicle.bodyModelParams
const wm = vehicle.wheelModelParams
const ep = world.environmentParams
const performanceParams = { fps: 0 }

// Top-level sections, created first so they appear in this order
const vehicleFolder = gui.addFolder('Vehicle')
const cameraFolder = gui.addFolder('Camera')
const worldFolder = gui.addFolder('World')
const effectsFolder = gui.addFolder('Effects')
const modelsFolder = gui.addFolder('Models')
const debugFolder = gui.addFolder('Debug')

const fpsController = debugFolder.add(performanceParams, 'fps').name('FPS').listen()

let guiVisible = true
window.addEventListener('keydown', (event) => {
  const target = event.target
  const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
  if (event.code !== 'Period' || event.repeat || isTyping) return

  guiVisible = !guiVisible
  gui.domElement.style.display = guiVisible ? '' : 'none'
  event.preventDefault()
})

worldFolder
  .add(ep, 'offsetY', -20, 50, 0.1)
  .name('Environment height')
  .onChange(() => world.applyEnvironmentParams())

cameraFolder
  .add(cameraParams, 'fov', 30, 100, 1)
  .name('FOV')
  .onChange(applyCameraParams)
cameraFolder
  .add(cameraParams, 'far', 500, 20000, 100)
  .name('Far clipping')
  .onChange(applyCameraParams)

const transporterFolder = worldFolder.addFolder('Transporter')
transporterFolder.close()
transporterFolder
  .add(transporterParams, 'enabled')
  .name('Enabled')
  .onChange(applyTransporterParams)
transporterFolder
  .add(transporterParams, 'radius', 1, 30, 0.1)
  .name('Radius')
  .onChange(applyTransporterParams)
transporterFolder
  .add(transporterParams, 'cooldown', 0.1, 5, 0.1)
  .name('Cooldown')
transporterFolder
  .add(transporterParams, 'opacity', 0, 1, 0.01)
  .name('Ring opacity')
  .onChange(applyTransporterParams)
transporterFolder
  .add(transporterParams, 'ax', -300, 300, 0.1)
  .name('A X')
  .onChange(applyTransporterParams)
transporterFolder
  .add(transporterParams, 'ay', -50, 100, 0.1)
  .name('A Y')
  .onChange(applyTransporterParams)
transporterFolder
  .add(transporterParams, 'az', -300, 300, 0.1)
  .name('A Z')
  .onChange(applyTransporterParams)
transporterFolder
  .add(transporterParams, 'bx', -300, 300, 0.1)
  .name('B X')
  .onChange(applyTransporterParams)
transporterFolder
  .add(transporterParams, 'by', -50, 100, 0.1)
  .name('B Y')
  .onChange(applyTransporterParams)
transporterFolder
  .add(transporterParams, 'bz', -300, 300, 0.1)
  .name('B Z')
  .onChange(applyTransporterParams)

const lightingFolder = worldFolder.addFolder('Lighting & Shadows')
lightingFolder.close()
lightingFolder
  .add(world.hemi, 'intensity', 0, 2, 0.01)
  .name('Ambient light')
lightingFolder
  .add(world.sun, 'intensity', 0, 5, 0.01)
  .name('Sun light')
lightingFolder
  .add(shadowParams, 'sunX', -100, 100, 1)
  .name('Sun X')
  .onChange(applyShadowParams)
lightingFolder
  .add(shadowParams, 'sunY', 5, 120, 1)
  .name('Sun Y')
  .onChange(applyShadowParams)
lightingFolder
  .add(shadowParams, 'sunZ', -100, 100, 1)
  .name('Sun Z')
  .onChange(applyShadowParams)
lightingFolder
  .add(shadowParams, 'shadowMapSize', [512, 1024, 2048, 4096])
  .name('Shadow map')
  .onChange((value) => {
    shadowParams.shadowMapSize = Number(value)
    applyShadowParams()
  })
lightingFolder
  .add(shadowParams, 'shadowCameraSize', 20, 140, 1)
  .name('Shadow area')
  .onChange(applyShadowParams)
lightingFolder
  .add(shadowParams, 'shadowBias', -0.01, 0.01, 0.0001)
  .name('Shadow bias')
  .onChange(applyShadowParams)
lightingFolder
  .add(shadowParams, 'shadowNormalBias', 0, 0.1, 0.001)
  .name('Normal bias')
  .onChange(applyShadowParams)
lightingFolder
  .add(shadowParams, 'shadowRadius', 0, 10, 0.1)
  .name('Shadow softness')
  .onChange(applyShadowParams)
lightingFolder
  .add(rp, 'glbReflectionIntensity', 0, 1, 0.01)
  .name('GLB reflection')
  .onChange(() => vehicle.applyReflectionParams())

buildPostSection(effectsFolder, postParams, applyPostParams)

buildModelSections(modelsFolder, bm, wm, vehicle)

buildTireMarksSection(effectsFolder, tm, vehicle)

buildVehicleSections(vehicleFolder, p, vehicle)

debugFolder
  .add(vehicle.debugParams, 'physics')
  .name('Show physics colliders')
  .onChange((visible) => physicsDebug.setVisible(visible))

const actions = {
  respawn: () => vehicle.respawn(),
  resetParams: () => {
    Object.assign(p, DEFAULT_PARAMS)
    Object.assign(bm, DEFAULT_BODY_MODEL_PARAMS)
    Object.assign(wm, DEFAULT_WHEEL_MODEL_PARAMS)
    Object.assign(rp, DEFAULT_REFLECTION_PARAMS)
    Object.assign(tm, DEFAULT_TIRE_MARK_PARAMS)
    Object.assign(ep, DEFAULT_ENVIRONMENT_PARAMS)
    Object.assign(postParams, DEFAULT_POST_PARAMS)
    Object.assign(cameraParams, DEFAULT_CAMERA_PARAMS)
    Object.assign(transporterParams, DEFAULT_TRANSPORTER_PARAMS)
    Object.assign(shadowParams, DEFAULT_SHADOW_PARAMS)
    world.hemi.intensity = DEFAULT_LIGHTING_PARAMS.ambientIntensity
    world.sun.intensity = DEFAULT_LIGHTING_PARAMS.sunIntensity
    world.applyEnvironmentParams()
    postBoostBlend = 0
    cameraBoostBlend = 0
    windLinesBlend = 0
    colorGradePass.uniforms.windLines.value = 0
    applyPostParams()
    applyCameraParams()
    applyTransporterParams()
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

// Start with every section collapsed and the panel itself closed
gui.foldersRecursive().forEach((folder) => folder.close())
gui.close()

// --- HUD -----------------------------------------------------------------------

const speedElement = document.querySelector('#speed .value')

const helpPanel = document.getElementById('help')
const helpToggle = document.getElementById('help-toggle')
const fullscreenToggle = document.getElementById('fullscreen-toggle')

helpToggle.addEventListener('click', () => {
  helpPanel.classList.toggle('open')
  helpToggle.blur() // keep Space/Enter presses driving the car, not the button
})

fullscreenToggle.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    document.documentElement.requestFullscreen()
  }
  fullscreenToggle.blur()
})

// Covers Esc and other ways of leaving fullscreen, not just our button
document.addEventListener('fullscreenchange', () => {
  fullscreenToggle.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement))
})

// --- Mobile controls -----------------------------------------------------------

const mobileJoystick = document.querySelector('#mobile-joystick')
const mobileBoost = document.querySelector('#mobile-boost')
const mobileReset = document.querySelector('#mobile-reset')
let mobileJoystickActive = false

function setMobileJoystickInput(x, y) {
  const deadzone = 0.2
  const steer = Math.abs(x) < deadzone ? 0 : shapeAxis(x) * 0.76
  const throttle = Math.abs(y) < deadzone ? 0 : shapeAxis(y) * 0.9

  vehicle.input.steerAxis = steer
  vehicle.input.throttleAxis = throttle
  vehicle.input.left = steer < -0.25
  vehicle.input.right = steer > 0.25
  vehicle.input.forward = throttle > 0.25
  vehicle.input.backward = throttle < -0.25
}

function resetMobileJoystick() {
  mobileJoystick?.style.setProperty('--stick-x', '0px')
  mobileJoystick?.style.setProperty('--stick-y', '0px')
  setMobileJoystickInput(0, 0)
}

if (mobileJoystick) {
  let joystickPointerId = null
  const updateJoystick = (event) => {
    if (joystickPointerId !== event.pointerId) return
    event.preventDefault()

    const rect = mobileJoystick.getBoundingClientRect()
    const maxDistance = rect.width * 0.38
    let dx = event.clientX - (rect.left + rect.width / 2)
    let dy = event.clientY - (rect.top + rect.height / 2)
    const distance = Math.hypot(dx, dy)
    if (distance > maxDistance) {
      dx = (dx / distance) * maxDistance
      dy = (dy / distance) * maxDistance
    }

    mobileJoystick.style.setProperty('--stick-x', `${dx}px`)
    mobileJoystick.style.setProperty('--stick-y', `${dy}px`)
    setMobileJoystickInput(dx / maxDistance, -dy / maxDistance)
  }

  mobileJoystick.addEventListener('pointerdown', (event) => {
    joystickPointerId = event.pointerId
    mobileJoystickActive = true
    mobileJoystick.setPointerCapture(event.pointerId)
    updateJoystick(event)
  })
  mobileJoystick.addEventListener('pointermove', updateJoystick)

  const stopJoystick = (event) => {
    if (joystickPointerId !== event.pointerId) return
    joystickPointerId = null
    mobileJoystickActive = false
    if (mobileJoystick.hasPointerCapture(event.pointerId)) {
      mobileJoystick.releasePointerCapture(event.pointerId)
    }
    resetMobileJoystick()
  }
  mobileJoystick.addEventListener('pointerup', stopJoystick)
  mobileJoystick.addEventListener('pointercancel', stopJoystick)
}

if (mobileBoost) {
  const setBoost = (active) => {
    vehicle.input.boost = active
    mobileBoost.classList.toggle('is-active', active)
  }

  mobileBoost.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    mobileBoost.setPointerCapture(event.pointerId)
    setBoost(true)
  })
  mobileBoost.addEventListener('pointerup', (event) => {
    if (mobileBoost.hasPointerCapture(event.pointerId)) {
      mobileBoost.releasePointerCapture(event.pointerId)
    }
    setBoost(false)
  })
  mobileBoost.addEventListener('pointercancel', () => setBoost(false))
}

if (mobileReset) {
  mobileReset.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    vehicle.respawn()
    resetMobileJoystick()
    mobileReset.blur()
  })
}

// --- Gamepad controls ----------------------------------------------------------

const gamepadInput = createGamepadInput(vehicle, {
  isExternalInputActive: () => mobileJoystickActive,
})

// --- Loop ----------------------------------------------------------------------

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

  physicsWorld.step(FIXED_STEP, delta, 3)

  gamepadInput.poll()
  vehicle.update(delta)
  world.update()
  orbitCamera.update(delta, cameraBoostBlend)
  updateTransporter(delta)
  physicsDebug.update()

  // Keep the shadow camera centered on the car so shadows follow it.
  followShadow(vehicle.group.position.x, vehicle.group.position.z)

  speedElement.textContent = Math.round(vehicle.speedKmh)
  const boosting = vehicle.input.boost || vehicle.input.gamepadBoost
  const boostTarget = boosting ? 1 : 0
  postBoostBlend = THREE.MathUtils.lerp(postBoostBlend, boostTarget, 1 - Math.exp(-8 * delta))
  cameraBoostBlend = THREE.MathUtils.lerp(cameraBoostBlend, boostTarget, 1 - Math.exp(-7 * delta))
  const windLinesTarget = boosting && vehicle.speedKmh > postParams.windLinesMinSpeedKmh ? 1 : 0
  windLinesBlend = THREE.MathUtils.lerp(windLinesBlend, windLinesTarget, 1 - Math.exp(-5 * delta))
  colorGradePass.uniforms.windLines.value = windLinesBlend * postParams.windLinesStrength
  const boostedFov = THREE.MathUtils.lerp(cameraParams.fov, 72, cameraBoostBlend)
  applyCameraParams(boostedFov)
  applyPostParams(postBoostBlend)
  colorGradePass.uniforms.time.value = now * 0.001

  if (postParams.enabled) {
    composer.render()
  } else {
    renderer.render(scene, camera)
  }
  requestAnimationFrame(tick)
}

tick()
