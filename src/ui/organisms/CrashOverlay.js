// Cracked-windshield overlay shown on a hard crash. Owns its <svg> element and
// draws a fresh radial crack each time it is triggered; the game decides when a
// crash happened and plays the accompanying sound.

const SVG_NS = 'http://www.w3.org/2000/svg'

export function createCrashOverlay() {
  const root = document.createElementNS(SVG_NS, 'svg')
  root.id = 'crack'
  document.body.append(root)

  let timer = 0

  const addLine = (x1, y1, x2, y2, w) => {
    const l = document.createElementNS(SVG_NS, 'line')
    l.setAttribute('x1', x1)
    l.setAttribute('y1', y1)
    l.setAttribute('x2', x2)
    l.setAttribute('y2', y2)
    l.setAttribute('stroke-width', w)
    root.appendChild(l)
  }

  function trigger(duration = 2.6) {
    while (root.firstChild) root.removeChild(root.firstChild)
    // Draw in pixel space matched to the viewport (robust; avoids non-uniform
    // viewBox stroke bugs).
    const W = window.innerWidth
    const H = window.innerHeight
    root.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const cx = W * (0.35 + Math.random() * 0.3)
    const cy = H * (0.28 + Math.random() * 0.26)
    const maxLen = Math.min(W, H)
    const spokes = 12 + Math.floor(Math.random() * 6)
    const tips = []
    for (let i = 0; i < spokes; i++) {
      const ang = (i / spokes) * Math.PI * 2 + (Math.random() - 0.5) * 0.3
      const len = maxLen * (0.35 + Math.random() * 0.6)
      const steps = 3 + Math.floor(Math.random() * 3)
      let px = cx
      let py = cy
      for (let s = 1; s <= steps; s++) {
        const r = (len * s) / steps
        const j = (Math.random() - 0.5) * maxLen * 0.07
        const nx = cx + Math.cos(ang) * r + Math.cos(ang + 1.57) * j
        const ny = cy + Math.sin(ang) * r + Math.sin(ang + 1.57) * j
        addLine(px, py, nx, ny, 1.4 + Math.random() * 1.8)
        px = nx
        py = ny
      }
      tips.push([cx + Math.cos(ang) * len * 0.55, cy + Math.sin(ang) * len * 0.55])
    }
    // Concentric web connecting adjacent spokes.
    for (let i = 0; i < tips.length; i++) {
      if (Math.random() < 0.65) {
        const a = tips[i]
        const b = tips[(i + 1) % tips.length]
        addLine(a[0], a[1], b[0], b[1], 1.1)
      }
    }
    root.classList.add('show')
    timer = duration
  }

  function clear() {
    root.classList.remove('show')
    timer = 0
  }

  // Auto-clears when the crack's lifetime elapses.
  function update(delta) {
    if (timer > 0) {
      timer -= delta
      if (timer <= 0) clear()
    }
  }

  return { trigger, clear, update }
}
