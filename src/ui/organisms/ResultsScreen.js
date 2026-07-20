// Results / fastest-times overlay shown when a lap finishes. Builds its own DOM
// (same ids/classes the stylesheet already targets) and owns its open state, so
// the game script just calls show() with formatted data and reads isOpen.

export function createResultsScreen({ onContinue } = {}) {
  const root = document.createElement('div')
  root.id = 'results'
  root.className = 'hidden'
  root.innerHTML = `
    <div class="rcard">
      <h2>Fastest times · <span id="results-track">—</span></h2>
      <ol id="results-list"></ol>
      <div class="stats">
        <div>Lap time: <b id="rs-time">—</b></div>
        <div>Top speed: <b id="rs-top">0</b> km/h</div>
        <div>Avg speed: <b id="rs-avg">0</b> km/h</div>
        <div>Jumps: <b id="rs-jumps">0</b></div>
      </div>
      <div class="ractions">
        <button id="results-continue">Continue ▸</button>
      </div>
    </div>`
  document.body.append(root)

  const $ = (id) => root.querySelector(`#${id}`)
  const trackEl = $('results-track')
  const listEl = $('results-list')
  const timeEl = $('rs-time')
  const topEl = $('rs-top')
  const avgEl = $('rs-avg')
  const jumpsEl = $('rs-jumps')

  let open = false

  $('results-continue').addEventListener('click', () => {
    hide()
    onContinue?.()
  })

  /**
   * @param {object} data
   * @param {string} data.trackName
   * @param {{rank:number,label:string,time:string,mine:boolean}[]} data.entries
   * @param {string} data.lapTime  already formatted
   * @param {number} data.topSpeed
   * @param {number} data.avgSpeed
   * @param {number} data.jumps
   */
  function show({ trackName, entries, lapTime, topSpeed, avgSpeed, jumps }) {
    trackEl.textContent = trackName
    listEl.innerHTML = ''
    for (const e of entries) {
      const li = document.createElement('li')
      if (e.mine) li.className = 'you'
      li.innerHTML =
        `<span class="rank">${e.rank}.</span>` +
        `<span class="who">${e.label}</span>` +
        `<span>${e.time}</span>`
      listEl.append(li)
    }
    timeEl.textContent = lapTime
    topEl.textContent = topSpeed
    avgEl.textContent = avgSpeed
    jumpsEl.textContent = jumps
    open = true
    root.classList.remove('hidden')
  }

  function hide() {
    open = false
    root.classList.add('hidden')
  }

  return {
    show,
    hide,
    get isOpen() {
      return open
    },
  }
}
