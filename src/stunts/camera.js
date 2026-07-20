import * as THREE from 'three'

// Chase / hood / cockpit follow-camera for the Stunts port. Owns the view mode
// and the per-frame follow maths; the game loop calls update(delta) (except in
// the debug top-down / frozen views, which it drives itself).

const VIEWS = ['chase', 'hood', 'cockpit']
const LABELS = { chase: 'Chase', hood: 'Hood', cockpit: 'Cockpit' }

/**
 * @param {object} deps
 * @param {THREE.PerspectiveCamera} deps.camera
 * @param {object} deps.vehicle
 * @param {{ setVisible(on:boolean):void }} deps.cockpitOverlay
 * @param {HTMLElement} [deps.viewButton]  cycles the view on click; shows the label
 * @param {() => boolean} [deps.isMenuOpen]  view cycling is disabled while true
 */
export function createCameraController({ camera, vehicle, cockpitOverlay, viewButton, isMenuOpen = () => false }) {
  const chaseOffset = new THREE.Vector3(0, 7, -13)
  const chaseLook = new THREE.Vector3(0, 2, 6)
  const hoodOffset = new THREE.Vector3(0, 3, -5.5)
  const hoodLook = new THREE.Vector3(0, 2, 10)
  const eyeOffset = new THREE.Vector3(0, 1.5, 0.0) // driver's eyeline inside the car
  const cockpitLook = new THREE.Vector3(0, 1.1, 10)

  const desiredPosition = new THREE.Vector3()
  const desiredTarget = new THREE.Vector3()
  const currentTarget = new THREE.Vector3().copy(vehicle.group.position)
  const cockpitEye = new THREE.Vector3()
  const cockpitTarget = new THREE.Vector3()

  let mode = 'chase'

  function setMode(next) {
    mode = next
    const cockpit = next === 'cockpit'
    cockpitOverlay.setVisible(cockpit)
    vehicle.group.visible = !cockpit // don't render the car body from inside it
    camera.fov = cockpit ? 74 : 60
    camera.updateProjectionMatrix()
    if (viewButton) viewButton.textContent = `◉ ${LABELS[next]}`
  }

  function cycle() {
    // No view switching while the start menu (bird's-eye) is up.
    if (isMenuOpen()) return
    const i = VIEWS.indexOf(mode)
    setMode(VIEWS[(i + 1) % VIEWS.length])
  }

  function updateChase(delta) {
    const chassis = vehicle.group
    const hood = mode === 'hood'
    const posOff = hood ? hoodOffset : chaseOffset
    const lookOff = hood ? hoodLook : chaseLook
    const minLift = hood ? 1.2 : 3
    desiredPosition.copy(posOff).applyQuaternion(chassis.quaternion).add(chassis.position)
    desiredPosition.y = Math.max(desiredPosition.y, chassis.position.y + minLift)
    desiredTarget.copy(lookOff).applyQuaternion(chassis.quaternion).add(chassis.position)

    const posLerp = hood ? 12 : 6
    camera.position.lerp(desiredPosition, 1 - Math.exp(-posLerp * delta))
    currentTarget.lerp(desiredTarget, 1 - Math.exp(-10 * delta))
    camera.lookAt(currentTarget)
  }

  function updateCockpit(delta) {
    const chassis = vehicle.group
    cockpitEye.copy(eyeOffset).applyQuaternion(chassis.quaternion).add(chassis.position)
    cockpitTarget.copy(cockpitLook).applyQuaternion(chassis.quaternion).add(chassis.position)
    camera.position.lerp(cockpitEye, 1 - Math.exp(-35 * delta))
    camera.lookAt(cockpitTarget)
  }

  function update(delta) {
    if (mode === 'cockpit') updateCockpit(delta)
    else updateChase(delta)
  }

  if (viewButton) viewButton.addEventListener('click', cycle)

  return { update, setMode, cycle, get mode() { return mode } }
}
