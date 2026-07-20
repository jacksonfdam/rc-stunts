// Start menu (shown over a bird's-eye track preview) and the ☰ button that
// reopens it. Builds its own DOM with the same ids/classes the stylesheet
// targets and exposes the sub-elements the game populates and wires (track /
// car / driver selects, meta readouts, colour-swatch container, drive button).
// Show/hide orchestration (camera, HUD, audio) stays in the game script.

export function createMenu() {
  const root = document.createElement('div')
  root.id = 'menu'
  root.innerHTML = `
    <div class="card">
      <h1>STUNTS<span>Web Port</span></h1>
      <label for="menu-track">Track</label>
      <select id="menu-track"></select>
      <div class="meta">Horizon: <b id="menu-horizon">—</b> · <b id="menu-tiles">0</b> tiles</div>
      <label for="menu-car">Car</label>
      <select id="menu-car"></select>
      <div class="meta" id="menu-car-stats">—</div>
      <label for="menu-driver">Driver</label>
      <select id="menu-driver"></select>
      <div class="meta" id="menu-driver-bio">—</div>
      <label>Car color</label>
      <div id="menu-colors"></div>
      <button id="menu-drive">Let's Drive ▸</button>
      <div class="foot">WASD / arrows to drive · Shift boost · Space jump · R respawn · C cockpit</div>
    </div>
    <div class="preview-hint">bird's-eye preview</div>`

  const openButton = document.createElement('button')
  openButton.id = 'open-menu'
  openButton.className = 'hidden'
  openButton.textContent = '☰ Menu'

  document.body.append(root, openButton)

  const $ = (id) => root.querySelector(`#${id}`)

  return {
    root,
    openButton,
    trackSelect: $('menu-track'),
    horizonEl: $('menu-horizon'),
    tilesEl: $('menu-tiles'),
    carSelect: $('menu-car'),
    carStatsEl: $('menu-car-stats'),
    driverSelect: $('menu-driver'),
    driverBioEl: $('menu-driver-bio'),
    colorsContainer: $('menu-colors'),
    driveButton: $('menu-drive'),
    isOpen: () => !root.classList.contains('hidden'),
  }
}
