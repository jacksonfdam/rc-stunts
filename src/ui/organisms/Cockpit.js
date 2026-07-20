// Cockpit overlay: A-pillars, dashboard and a speed gauge framing the
// windshield in the cockpit camera view. Builds its own DOM; the game toggles
// its visibility per camera mode and feeds it the current speed.

export function createCockpit() {
  const root = document.createElement('div')
  root.id = 'cockpit'
  root.className = 'hidden'
  root.innerHTML = `
    <div class="roof"></div>
    <div class="pillar left"></div>
    <div class="pillar right"></div>
    <div class="dash"></div>
    <div class="wheel"></div>
    <div class="gauge"><b id="cockpit-speed">0</b><small>km/h</small></div>`
  document.body.append(root)

  const speedEl = root.querySelector('#cockpit-speed')

  return {
    setVisible: (on) => root.classList.toggle('hidden', !on),
    setSpeed: (kmh) => { speedEl.textContent = kmh },
  }
}
