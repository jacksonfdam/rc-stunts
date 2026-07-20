// Start menu styled after the original Stunts (1990) selection screen: road-sign
// buttons over the track preview inside a hazard-striped frame, with the car and
// its "Let's Drive" plate in the centre. Each sign carries a transparent native
// <select> so a click opens the real picker. Builds its own DOM and exposes the
// sub-elements the game populates/wires; show/hide orchestration stays in the game.

export function createMenu() {
  const root = document.createElement('div')
  root.id = 'menu'
  root.innerHTML = `
    <div class="menu-frame">
      <div class="sign sign--car">
        <div class="sign-shape"><span>Car</span></div>
        <select id="menu-car" aria-label="Car"></select>
        <div class="sign-cap" id="menu-car-stats">—</div>
      </div>

      <div class="sign sign--driver">
        <div class="sign-shape"><span>Driver</span></div>
        <select id="menu-driver" aria-label="Driver"></select>
        <div class="sign-cap" id="menu-driver-bio">—</div>
      </div>

      <div class="sign sign--track">
        <div class="sign-shape"><span>Track</span></div>
        <select id="menu-track" aria-label="Track"></select>
        <div class="sign-cap">Horizon: <b id="menu-horizon">—</b> · <b id="menu-tiles">0</b> tiles</div>
      </div>

      <div class="sign sign--colour">
        <div class="sign-shape"><span>Colour</span></div>
        <button type="button" class="sign-hit" id="menu-colour-toggle" aria-label="Car colour"></button>
        <div class="sign-cap sign-colours" id="menu-colors"></div>
      </div>

      <div class="menu-hero">
        <div class="menu-hero-frame">
          <div class="menu-wordmark">STUNTS<span>Web Port</span></div>
          <button id="menu-drive">Let's Drive ▸</button>
        </div>
        <div class="menu-plate">STUNTS</div>
      </div>

      <div class="menu-foot">WASD / arrows · Shift boost · Space jump · R respawn · C view</div>
    </div>`

  const openButton = document.createElement('button')
  openButton.id = 'open-menu'
  openButton.className = 'hidden'
  openButton.textContent = '☰ Menu'

  document.body.append(root, openButton)

  const $ = (sel) => root.querySelector(sel)
  const coloursContainer = $('#menu-colors')
  // The green "Colour" sign reveals/hides the swatch strip.
  $('#menu-colour-toggle').addEventListener('click', () => {
    coloursContainer.classList.toggle('open')
  })

  return {
    root,
    openButton,
    trackSelect: $('#menu-track'),
    horizonEl: $('#menu-horizon'),
    tilesEl: $('#menu-tiles'),
    carSelect: $('#menu-car'),
    carStatsEl: $('#menu-car-stats'),
    driverSelect: $('#menu-driver'),
    driverBioEl: $('#menu-driver-bio'),
    colorsContainer: coloursContainer,
    driveButton: $('#menu-drive'),
    isOpen: () => !root.classList.contains('hidden'),
  }
}
