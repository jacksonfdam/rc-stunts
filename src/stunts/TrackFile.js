/**
 * Parser for the classic Stunts (1990) `.TRK` track format.
 *
 * A track file is 1802 bytes:
 *   0x0000..0x0383  track layout  — 30x30 grid, 1 byte/tile, left→right, BOTTOM→top
 *   0x0384          horizon byte  — scenery theme (see HORIZONS)
 *   0x0385..0x0708  terrain grid  — 30x30 grid, 1 byte/tile, left→right, TOP→bottom
 *   0x0709          spare byte    — editor id, unused by the game
 *
 * The two grids use *opposite* row order, so both accessors below take a
 * bottom-origin (x, y) and normalise internally. Files shorter than 1802 bytes
 * are tolerated (the game itself copies what's there over the current track),
 * so missing sections simply read as zero.
 *
 * Format reference: https://wiki.stunts.hu/wiki/Track_file
 */

export const GRID = 30
export const GRID_CELLS = GRID * GRID // 900
export const FILE_SIZE = 1802

export const TRACK_OFFSET = 0x0000
export const HORIZON_OFFSET = 0x0384
export const TERRAIN_OFFSET = 0x0385

export const HORIZONS = ['Desert', 'Tropical', 'Alpine', 'City', 'Country', 'Chaotic']

// Cells occupied by a neighbouring multi-tile element's anchor. They carry no
// geometry of their own — the anchor tile draws the whole 2x2 / 2x1 piece.
export const FILLERS = new Set([0xff, 0xfe, 0xfd])

export class TrackFile {
  /**
   * @param {Uint8Array} track   900 bytes, left→right / bottom→top
   * @param {number} horizon     0..5
   * @param {Uint8Array} terrain 900 bytes, left→right / top→bottom
   */
  constructor(track, horizon, terrain) {
    this.track = track
    this.horizon = horizon
    this.terrain = terrain
  }

  get horizonName() {
    return HORIZONS[this.horizon] ?? `Unknown(${this.horizon})`
  }

  /** Track tile at column x (0=left) and row y (0=bottom). */
  trackAt(x, y) {
    if (x < 0 || x >= GRID || y < 0 || y >= GRID) return 0
    return this.track[y * GRID + x]
  }

  /** Terrain tile at column x (0=left) and row y (0=bottom). */
  terrainAt(x, y) {
    if (x < 0 || x >= GRID || y < 0 || y >= GRID) return 0
    // Terrain rows are stored top→bottom, so flip the bottom-origin y.
    return this.terrain[(GRID - 1 - y) * GRID + x]
  }

  static parse(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)

    const track = new Uint8Array(GRID_CELLS)
    const terrain = new Uint8Array(GRID_CELLS)

    track.set(bytes.subarray(TRACK_OFFSET, TRACK_OFFSET + GRID_CELLS).subarray(0, GRID_CELLS))
    if (bytes.length > TERRAIN_OFFSET) {
      const src = bytes.subarray(TERRAIN_OFFSET, TERRAIN_OFFSET + GRID_CELLS)
      terrain.set(src.subarray(0, GRID_CELLS))
    }

    const horizon = bytes[HORIZON_OFFSET] ?? 0
    return new TrackFile(track, horizon, terrain)
  }

  /** Serialise back to a canonical 1802-byte `.TRK` buffer. */
  toBuffer() {
    const bytes = new Uint8Array(FILE_SIZE)
    bytes.set(this.track.subarray(0, GRID_CELLS), TRACK_OFFSET)
    bytes[HORIZON_OFFSET] = this.horizon
    bytes.set(this.terrain.subarray(0, GRID_CELLS), TERRAIN_OFFSET)
    return bytes
  }
}

/**
 * A hand-built demo track so the viewer has something to render before any
 * real `.TRK` is loaded: a rectangular paved loop on flat terrain, with the
 * four corners marked so orientation-aware rendering has data to work with
 * later. Uses documented ids (paved straight 0x04, paved corner 0x06).
 */
export function createDemoTrackFile() {
  const track = new Uint8Array(GRID_CELLS)
  const terrain = new Uint8Array(GRID_CELLS) // all 0x00 = flat grass

  const PAVED_STRAIGHT = 0x04
  const PAVED_CORNER = 0x06
  const set = (x, y, v) => {
    track[y * GRID + x] = v
  }

  const lo = 8
  const hi = 21
  for (let x = lo; x <= hi; x++) {
    set(x, lo, PAVED_STRAIGHT) // bottom edge
    set(x, hi, PAVED_STRAIGHT) // top edge
  }
  for (let y = lo; y <= hi; y++) {
    set(lo, y, PAVED_STRAIGHT) // left edge
    set(hi, y, PAVED_STRAIGHT) // right edge
  }
  // Corners overwrite the four turns
  set(lo, lo, PAVED_CORNER)
  set(hi, lo, PAVED_CORNER)
  set(lo, hi, PAVED_CORNER)
  set(hi, hi, PAVED_CORNER)

  return new TrackFile(track, 0, terrain)
}
