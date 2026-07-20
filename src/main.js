import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import GUI from 'lil-gui'
import { createPostProcessing, DEFAULT_POST_PARAMS } from './engine/postProcessing.js'
import { createPhysicsDebug } from './engine/physicsDebug.js'
import { createShadowController } from './engine/shadow.js'
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

const cameraOffset = new THREE.Vector3(0, 5.2, -7.4) // higher angle so more of the car is visible
const cameraLookOffset = new THREE.Vector3(0, 1.2, 3.2) // look slightly ahead
const airborneCameraOffset = new THREE.Vector3(0, 8.2, -12.5)
const airborneCameraLookOffset = new THREE.Vector3(0, 0.6, 9.5)
const cameraOrbitPivotOffset = new THREE.Vector3(0, 1.2, 0) // center of the car for mouse orbit
const cameraOrbitLocalOffset = new THREE.Vector3()
const blendedCameraOffset = new THREE.Vector3()
const blendedCameraLookOffset = new THREE.Vector3()
const cameraPivot = new THREE.Vector3()
const normalTarget = new THREE.Vector3()
const orbitTarget = new THREE.Vector3()
const desiredPosition = new THREE.Vector3()
const desiredTarget = new THREE.Vector3()
const currentTarget = new THREE.Vector3()
const orbitOffset = new THREE.Vector3()
const localXAxis = new THREE.Vector3(1, 0, 0)
const localYAxis = new THREE.Vector3(0, 1, 0)
const CAMERA_ZOOM_MIN = 0.4
const CAMERA_ZOOM_MAX = 1.5
let airborneCameraBlend = 0
const cameraOrbit = {
  yaw: 0,
  pitch: 0,
  targetYaw: 0,
  targetPitch: 0,
  zoom: 1,
  targetZoom: 1,
  dragging: false,
  lastX: 0,
  lastY: 0,
}

function normalizeAngleRadians(angle) {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  cameraOrbit.dragging = true
  cameraOrbit.lastX = event.clientX
  cameraOrbit.lastY = event.clientY
  renderer.domElement.setPointerCapture(event.pointerId)
})

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!cameraOrbit.dragging) return

  const dx = event.clientX - cameraOrbit.lastX
  const dy = event.clientY - cameraOrbit.lastY
  cameraOrbit.lastX = event.clientX
  cameraOrbit.lastY = event.clientY

  // Low sensitivity plus smoothing in updateCamera makes the orbit easier to control.
  cameraOrbit.targetYaw -= dx * 0.0035
  cameraOrbit.targetPitch = THREE.MathUtils.clamp(cameraOrbit.targetPitch - dy * 0.0028, -0.5, 0.35)
})

renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault()
  cameraOrbit.targetZoom = THREE.MathUtils.clamp(
    cameraOrbit.targetZoom + event.deltaY * 0.001,
    CAMERA_ZOOM_MIN,
    CAMERA_ZOOM_MAX
  )
}, { passive: false })

function stopCameraDrag(event) {
  cameraOrbit.dragging = false
  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId)
  }
}

renderer.domElement.addEventListener('pointerup', stopCameraDrag)
renderer.domElement.addEventListener('pointercancel', stopCameraDrag)

function updateCamera(delta) {
  const chassis = vehicle.group
  const accelerating =
    vehicle.input.forward ||
    vehicle.input.backward ||
    Math.abs(vehicle.input.throttleAxis) > 0.05
  if (accelerating) {
    cameraOrbit.dragging = false
    cameraOrbit.yaw = normalizeAngleRadians(cameraOrbit.yaw)
    cameraOrbit.targetYaw = normalizeAngleRadians(cameraOrbit.targetYaw)
    const resetLerp = 1 - Math.exp(-8 * delta)
    cameraOrbit.targetYaw = THREE.MathUtils.lerp(cameraOrbit.targetYaw, 0, resetLerp)
    cameraOrbit.targetPitch = THREE.MathUtils.lerp(cameraOrbit.targetPitch, 0, resetLerp)
  }

  const orbitLerp = 1 - Math.exp(-14 * delta)
  cameraOrbit.yaw = THREE.MathUtils.lerp(cameraOrbit.yaw, cameraOrbit.targetYaw, orbitLerp)
  cameraOrbit.pitch = THREE.MathUtils.lerp(cameraOrbit.pitch, cameraOrbit.targetPitch, orbitLerp)
  cameraOrbit.zoom = THREE.MathUtils.lerp(cameraOrbit.zoom, cameraOrbit.targetZoom, orbitLerp)

  const grounded = vehicle.raycastVehicle.wheelInfos.some((wheel) => wheel.isInContact)
  const upwardSpeed = Math.max(0, vehicle.chassisBody.velocity.y)
  const airborneTarget = grounded ? 0 : THREE.MathUtils.clamp(0.45 + upwardSpeed / 12, 0.45, 1)
  airborneCameraBlend = THREE.MathUtils.lerp(
    airborneCameraBlend,
    airborneTarget,
    1 - Math.exp(-(grounded ? 5 : 3) * delta)
  )

  blendedCameraLookOffset
    .copy(cameraLookOffset)
    .lerp(airborneCameraLookOffset, airborneCameraBlend)
  normalTarget.copy(blendedCameraLookOffset).applyQuaternion(chassis.quaternion).add(chassis.position)
  orbitTarget.copy(cameraOrbitPivotOffset).applyQuaternion(chassis.quaternion).add(chassis.position)
  const orbitAmount = THREE.MathUtils.clamp(
    Math.abs(cameraOrbit.yaw) * 1.5 + Math.abs(cameraOrbit.pitch) * 2 + (cameraOrbit.dragging ? 1 : 0),
    0,
    1
  )

  cameraPivot.copy(orbitTarget)
  blendedCameraOffset.copy(cameraOffset).lerp(airborneCameraOffset, airborneCameraBlend)
  // Subtle dolly-out while boosting: paired with the FOV increase it sells speed
  const boostPullBack = 1 + 0.08 * cameraBoostBlend
  cameraOrbitLocalOffset
    .copy(blendedCameraOffset)
    .sub(cameraOrbitPivotOffset)
    .multiplyScalar(cameraOrbit.zoom * boostPullBack)
  orbitOffset
    .copy(cameraOrbitLocalOffset)
    .applyAxisAngle(localXAxis, cameraOrbit.pitch)
    .applyAxisAngle(localYAxis, cameraOrbit.yaw)

  desiredPosition.copy(orbitOffset).applyQuaternion(chassis.quaternion).add(cameraPivot)
  // Keep the camera from clipping under the ground when the car flips
  desiredPosition.y = Math.max(desiredPosition.y, chassis.position.y + 1.5, 1.2)

  desiredTarget.copy(normalTarget).lerp(orbitTarget, orbitAmount)

  const positionLerp = 1 - Math.exp(-6 * delta)
  const targetLerp = 1 - Math.exp(-10 * delta)
  camera.position.lerp(desiredPosition, positionLerp)
  currentTarget.lerp(desiredTarget, targetLerp)
  camera.lookAt(currentTarget)
}

currentTarget.copy(vehicle.group.position)

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

function shapeMobileAxis(value) {
  const sign = Math.sign(value)
  return sign * Math.pow(Math.abs(value), 1.7)
}

function setMobileJoystickInput(x, y) {
  const deadzone = 0.2
  const steer = Math.abs(x) < deadzone ? 0 : shapeMobileAxis(x) * 0.76
  const throttle = Math.abs(y) < deadzone ? 0 : shapeMobileAxis(y) * 0.9

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

let gamepadJumpWasPressed = false

function gamepadButtonPressed(gamepad, index, threshold = 0.5) {
  const button = gamepad.buttons[index]
  return Boolean(button?.pressed || button?.value > threshold)
}

function gamepadButtonValue(gamepad, index) {
  return gamepad.buttons[index]?.value ?? 0
}

function updateGamepadControls() {
  const gamepads = navigator.getGamepads?.() ?? []
  const gamepad = gamepads.find(Boolean)
  if (!gamepad) {
    if (!mobileJoystickActive) {
      vehicle.input.steerAxis = 0
      vehicle.input.throttleAxis = 0
    }
    vehicle.input.gamepadBoost = false
    gamepadJumpWasPressed = false
    return
  }

  const dpadX = (gamepadButtonPressed(gamepad, 15) ? 1 : 0) - (gamepadButtonPressed(gamepad, 14) ? 1 : 0)
  const dpadY = (gamepadButtonPressed(gamepad, 12) ? 1 : 0) - (gamepadButtonPressed(gamepad, 13) ? 1 : 0)
  const steer = Math.abs(gamepad.axes[0] ?? 0) > 0.12 ? shapeMobileAxis(gamepad.axes[0]) : dpadX
  const gas = gamepadButtonValue(gamepad, 7)
  const reverse = gamepadButtonValue(gamepad, 6)
  const triggerThrottle = gas - reverse
  const throttle = Math.abs(triggerThrottle) > 0.05 ? triggerThrottle : dpadY

  if (!mobileJoystickActive) {
    vehicle.input.steerAxis = steer
    vehicle.input.throttleAxis = throttle
  }
  vehicle.input.gamepadBoost =
    gamepadButtonPressed(gamepad, 1) ||
    gamepadButtonPressed(gamepad, 5)

  const jumpPressed = gamepadButtonPressed(gamepad, 0)
  if (jumpPressed && !gamepadJumpWasPressed) vehicle.requestJump()
  gamepadJumpWasPressed = jumpPressed
}

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

  updateGamepadControls()
  vehicle.update(delta)
  world.update()
  updateCamera(delta)
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
