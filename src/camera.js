import * as THREE from 'three'

// Playground chase camera: follows the car, orbits with left-drag, zooms with
// the wheel, lifts and widens when airborne, and dollies out while boosting.
// The orbit re-centres behind the car as soon as the player accelerates.

const CAMERA_ZOOM_MIN = 0.4
const CAMERA_ZOOM_MAX = 1.5

const normalizeAngleRadians = (angle) =>
  THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI

/**
 * @param {object} deps
 * @param {THREE.WebGLRenderer} deps.renderer  its canvas receives the orbit input
 * @param {THREE.PerspectiveCamera} deps.camera
 * @param {object} deps.vehicle
 */
export function createOrbitCamera({ renderer, camera, vehicle }) {
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
  const currentTarget = new THREE.Vector3().copy(vehicle.group.position)
  const orbitOffset = new THREE.Vector3()
  const localXAxis = new THREE.Vector3(1, 0, 0)
  const localYAxis = new THREE.Vector3(0, 1, 0)
  let airborneCameraBlend = 0
  const orbit = {
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

  const canvas = renderer.domElement
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    orbit.dragging = true
    orbit.lastX = event.clientX
    orbit.lastY = event.clientY
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!orbit.dragging) return
    const dx = event.clientX - orbit.lastX
    const dy = event.clientY - orbit.lastY
    orbit.lastX = event.clientX
    orbit.lastY = event.clientY
    // Low sensitivity plus smoothing in update() makes the orbit easier to control.
    orbit.targetYaw -= dx * 0.0035
    orbit.targetPitch = THREE.MathUtils.clamp(orbit.targetPitch - dy * 0.0028, -0.5, 0.35)
  })
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      orbit.targetZoom = THREE.MathUtils.clamp(
        orbit.targetZoom + event.deltaY * 0.001,
        CAMERA_ZOOM_MIN,
        CAMERA_ZOOM_MAX
      )
    },
    { passive: false }
  )
  const stopDrag = (event) => {
    orbit.dragging = false
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId)
    }
  }
  canvas.addEventListener('pointerup', stopDrag)
  canvas.addEventListener('pointercancel', stopDrag)

  // boostBlend (0..1) dollies the camera out a touch while boosting.
  function update(delta, boostBlend = 0) {
    const chassis = vehicle.group
    const accelerating =
      vehicle.input.forward ||
      vehicle.input.backward ||
      Math.abs(vehicle.input.throttleAxis) > 0.05
    if (accelerating) {
      orbit.dragging = false
      orbit.yaw = normalizeAngleRadians(orbit.yaw)
      orbit.targetYaw = normalizeAngleRadians(orbit.targetYaw)
      const resetLerp = 1 - Math.exp(-8 * delta)
      orbit.targetYaw = THREE.MathUtils.lerp(orbit.targetYaw, 0, resetLerp)
      orbit.targetPitch = THREE.MathUtils.lerp(orbit.targetPitch, 0, resetLerp)
    }

    const orbitLerp = 1 - Math.exp(-14 * delta)
    orbit.yaw = THREE.MathUtils.lerp(orbit.yaw, orbit.targetYaw, orbitLerp)
    orbit.pitch = THREE.MathUtils.lerp(orbit.pitch, orbit.targetPitch, orbitLerp)
    orbit.zoom = THREE.MathUtils.lerp(orbit.zoom, orbit.targetZoom, orbitLerp)

    const grounded = vehicle.raycastVehicle.wheelInfos.some((wheel) => wheel.isInContact)
    const upwardSpeed = Math.max(0, vehicle.chassisBody.velocity.y)
    const airborneTarget = grounded ? 0 : THREE.MathUtils.clamp(0.45 + upwardSpeed / 12, 0.45, 1)
    airborneCameraBlend = THREE.MathUtils.lerp(
      airborneCameraBlend,
      airborneTarget,
      1 - Math.exp(-(grounded ? 5 : 3) * delta)
    )

    blendedCameraLookOffset.copy(cameraLookOffset).lerp(airborneCameraLookOffset, airborneCameraBlend)
    normalTarget.copy(blendedCameraLookOffset).applyQuaternion(chassis.quaternion).add(chassis.position)
    orbitTarget.copy(cameraOrbitPivotOffset).applyQuaternion(chassis.quaternion).add(chassis.position)
    const orbitAmount = THREE.MathUtils.clamp(
      Math.abs(orbit.yaw) * 1.5 + Math.abs(orbit.pitch) * 2 + (orbit.dragging ? 1 : 0),
      0,
      1
    )

    cameraPivot.copy(orbitTarget)
    blendedCameraOffset.copy(cameraOffset).lerp(airborneCameraOffset, airborneCameraBlend)
    // Subtle dolly-out while boosting: paired with the FOV increase it sells speed.
    const boostPullBack = 1 + 0.08 * boostBlend
    cameraOrbitLocalOffset
      .copy(blendedCameraOffset)
      .sub(cameraOrbitPivotOffset)
      .multiplyScalar(orbit.zoom * boostPullBack)
    orbitOffset
      .copy(cameraOrbitLocalOffset)
      .applyAxisAngle(localXAxis, orbit.pitch)
      .applyAxisAngle(localYAxis, orbit.yaw)

    desiredPosition.copy(orbitOffset).applyQuaternion(chassis.quaternion).add(cameraPivot)
    // Keep the camera from clipping under the ground when the car flips.
    desiredPosition.y = Math.max(desiredPosition.y, chassis.position.y + 1.5, 1.2)

    desiredTarget.copy(normalTarget).lerp(orbitTarget, orbitAmount)

    camera.position.lerp(desiredPosition, 1 - Math.exp(-6 * delta))
    currentTarget.lerp(desiredTarget, 1 - Math.exp(-10 * delta))
    camera.lookAt(currentTarget)
  }

  return { update }
}
