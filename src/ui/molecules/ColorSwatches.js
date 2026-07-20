// Car-colour picker molecule: a row of preset swatch atoms plus a native
// colour input. One controller can render into several containers (e.g. the
// menu and the in-game panel) and keeps the active state in sync across them.

export const DEFAULT_CAR_COLORS = [
  0xef4444, 0x2563eb, 0x16a34a, 0xf59e0b, 0xdb2777,
  0x7c3aed, 0x0891b2, 0xe11d48, 0x111827, 0xf8fafc,
]

const toHex = (color) => `#${color.toString(16).padStart(6, '0')}`

/**
 * @param {object} opts
 * @param {number[]} [opts.colors] preset palette (hex ints)
 * @param {number} opts.initial initial selected colour
 * @param {(color:number)=>void} opts.onChange called whenever a colour is picked
 */
export function createColorSwatches({ colors = DEFAULT_CAR_COLORS, initial, onChange }) {
  const swatches = [] // { el, color } across every mount, for active-state sync
  let current = initial

  const setActive = (color) => {
    current = color
    for (const s of swatches) s.el.classList.toggle('active', s.color === color)
  }
  const pick = (color) => {
    setActive(color)
    onChange(color)
  }

  function mount(container) {
    for (const color of colors) {
      const el = document.createElement('div')
      el.className = 'swatch'
      el.style.background = toHex(color)
      el.addEventListener('click', () => pick(color))
      if (color === current) el.classList.add('active')
      swatches.push({ el, color })
      container.append(el)
    }

    const custom = document.createElement('input')
    custom.type = 'color'
    custom.value = toHex(current)
    custom.title = 'Custom colour'
    // A custom colour matches no preset, so all presets deactivate.
    custom.addEventListener('input', () => pick(parseInt(custom.value.slice(1), 16)))
    container.append(custom)
  }

  return {
    mount,
    setActive,
    get color() {
      return current
    },
  }
}
