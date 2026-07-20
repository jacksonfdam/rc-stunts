// In-race HUD: lap/run timer, speed readout, race position, wrong-way and
// opponent-proximity warnings. Builds its own DOM (same ids/classes the
// stylesheet targets) and exposes setters, so the game logic stays free of
// direct DOM access. The cockpit overlay and crash effect are separate.

export function createHud() {
  const frag = document.createDocumentFragment()

  const oppHint = element('div', { id: 'opp-hint', class: 'hidden', text: '◄ Opponent Near' })

  const timer = element('div', { id: 'timer', class: 'idle' })
  const timerLabel = element('small', { id: 'timer-label', text: 'TIME' })
  const timerValue = element('span', { id: 'timer-value', text: '0:00.000' })
  const lapInfo = element('div', { id: 'lap-info', class: 'hidden' })
  const lapCount = element('b', { id: 'lap-count', text: '1' })
  const bestLap = element('span', { id: 'best-lap', text: '—' })
  lapInfo.append('Lap ', lapCount, ' · Best ', bestLap)
  timer.append(timerLabel, timerValue, lapInfo)

  const speed = element('div', { id: 'speed' })
  const speedValue = element('b', { id: 'speed-value', text: '0' })
  speed.append(speedValue, element('span', { text: 'km/h' }))

  const position = element('div', { id: 'position' })
  const posValue = element('b', { id: 'pos-value', text: '1st' })
  position.append(posValue, element('span', { text: ' / 2' }))

  const wrongWay = element('div', { id: 'wrong-way', class: 'hidden', text: '⚠ WRONG WAY' })

  frag.append(oppHint, timer, speed, position, wrongWay)
  document.body.append(frag)

  const toggleHidden = (el, on) => el.classList.toggle('hidden', !on)

  return {
    setSpeed: (kmh) => { speedValue.textContent = kmh },
    setTimer: (text) => { timerValue.textContent = text },
    setTimerLabel: (text) => { timerLabel.textContent = text },
    setIdle: (on) => timer.classList.toggle('idle', on),
    setLapCount: (n) => { lapCount.textContent = String(n) },
    setBestLap: (text) => { bestLap.textContent = text },
    showLapInfo: (on) => toggleHidden(lapInfo, on),
    setPosition: (text) => { posValue.textContent = text },
    setWrongWay: (on) => toggleHidden(wrongWay, on),
    setOpponentHint: (on) => toggleHidden(oppHint, on),
    // Menu open/close toggles the driving readouts. The per-frame warnings
    // (opponent hint, wrong-way) are only force-hidden here.
    setVisible: (on) => {
      toggleHidden(speed, on)
      toggleHidden(timer, on)
      toggleHidden(position, on)
      if (!on) {
        toggleHidden(oppHint, false)
        toggleHidden(wrongWay, false)
      }
    },
  }
}

function element(tag, { id, class: className, text } = {}) {
  const el = document.createElement(tag)
  if (id) el.id = id
  if (className) el.className = className
  if (text != null) el.textContent = text
  return el
}
