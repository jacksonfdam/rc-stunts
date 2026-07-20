// Browser Gamepad API → vehicle input. Shared by both entry points. Poll once
// per frame. Left stick / D-pad steer and drive, triggers gas/brake, A jumps,
// B / right-bumper boost.

// Ease analog sticks: gentle near centre, full near the edge. Also used by the
// on-screen mobile joystick.
export const shapeAxis = (value) => Math.sign(value) * Math.pow(Math.abs(value), 1.7)

const pressed = (gamepad, index, threshold = 0.5) => {
  const button = gamepad.buttons[index]
  return Boolean(button?.pressed || button?.value > threshold)
}

const buttonValue = (gamepad, index) => gamepad.buttons[index]?.value ?? 0

/**
 * @param {object} vehicle  the Vehicle whose `input` is written
 * @param {object} [opts]
 * @param {() => boolean} [opts.isExternalInputActive]  when true, another input
 *   source (e.g. an on-screen joystick) owns the steer/throttle axes and the
 *   gamepad must not overwrite them.
 */
export function createGamepadInput(vehicle, { isExternalInputActive = () => false } = {}) {
  let jumpWasPressed = false

  function poll() {
    const gamepad = (navigator.getGamepads?.() ?? []).find(Boolean)
    if (!gamepad) {
      if (!isExternalInputActive()) {
        vehicle.input.steerAxis = 0
        vehicle.input.throttleAxis = 0
      }
      vehicle.input.gamepadBoost = false
      jumpWasPressed = false
      return
    }

    const dpadX = (pressed(gamepad, 15) ? 1 : 0) - (pressed(gamepad, 14) ? 1 : 0)
    const dpadY = (pressed(gamepad, 12) ? 1 : 0) - (pressed(gamepad, 13) ? 1 : 0)
    const steer = Math.abs(gamepad.axes[0] ?? 0) > 0.12 ? shapeAxis(gamepad.axes[0]) : dpadX
    const gas = buttonValue(gamepad, 7)
    const reverse = buttonValue(gamepad, 6)
    const triggerThrottle = gas - reverse
    const throttle = Math.abs(triggerThrottle) > 0.05 ? triggerThrottle : dpadY

    if (!isExternalInputActive()) {
      vehicle.input.steerAxis = steer
      vehicle.input.throttleAxis = throttle
    }
    vehicle.input.gamepadBoost = pressed(gamepad, 1) || pressed(gamepad, 5)

    const jumpPressed = pressed(gamepad, 0)
    if (jumpPressed && !jumpWasPressed) vehicle.requestJump()
    jumpWasPressed = jumpPressed
  }

  return { poll }
}
