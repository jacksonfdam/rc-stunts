/**
 * Classification of Stunts track-tile ids into renderable categories.
 *
 * The full id table is large and orientation-sensitive; this first pass groups
 * ids into broad categories so the viewer can draw distinct *placeholder*
 * blocks (colour-coded) and generate colliders. Faithful per-piece geometry
 * (real corners, loops, ramps) replaces the placeholders in a later step —
 * see the CATEGORY comments for what each will eventually become.
 *
 * Documented id ranges (https://wiki.stunts.hu/wiki/Track_file):
 *   paved straight  0x04–0x05      elevated road  0x22–0x23
 *   loop            0x40–0x41      pipe           0x44–0x45
 *   tunnel          0x42–0x43
 */

import { FILLERS } from './TrackFile.js'

export const CATEGORY = {
  EMPTY: 'empty',
  FILLER: 'filler',
  ROAD: 'road',
  CORNER: 'corner',
  RAMP: 'ramp',
  LOOP: 'loop',
  PIPE: 'pipe',
  TUNNEL: 'tunnel',
  ELEVATED: 'elevated',
  SPECIAL: 'special',
}

const CATEGORY_STYLE = {
  [CATEGORY.ROAD]: { color: 0x3f3f46, height: 0.4 },
  [CATEGORY.CORNER]: { color: 0x52525b, height: 0.4 },
  [CATEGORY.RAMP]: { color: 0x6d28d9, height: 0.8 },
  [CATEGORY.LOOP]: { color: 0xdb2777, height: 2.4 },
  [CATEGORY.PIPE]: { color: 0x0891b2, height: 1.6 },
  [CATEGORY.TUNNEL]: { color: 0x334155, height: 1.6 },
  // Raised terrain / hillside track pieces (ids >= 0x80). Across 83 real
  // tracks these are 13k tiles / 46 distinct ids — the bulk of hilly courses.
  // Rendered as taller earthy blocks until per-id heights are known.
  [CATEGORY.ELEVATED]: { color: 0x6b4f34, height: 3.2 },
  [CATEGORY.SPECIAL]: { color: 0xca8a04, height: 0.6 },
}

// Explicit id → category overrides for the ranges we know. Everything else
// non-zero falls back to ROAD so unknown pieces are still drivable.
function categoryForId(id) {
  if (id === 0x00) return CATEGORY.EMPTY
  if (FILLERS.has(id)) return CATEGORY.FILLER

  if (id === 0x04 || id === 0x05) return CATEGORY.ROAD
  if (id === 0x22 || id === 0x23) return CATEGORY.RAMP
  if (id === 0x40 || id === 0x41) return CATEGORY.LOOP
  if (id === 0x44 || id === 0x45) return CATEGORY.PIPE
  if (id === 0x42 || id === 0x43) return CATEGORY.TUNNEL

  // Paved/dirt/ice corners cluster in these low ranges in most tracks.
  if ((id >= 0x06 && id <= 0x0f) || (id >= 0x14 && id <= 0x1f)) return CATEGORY.CORNER

  // Ids >= 0x80 (fillers already handled above) are raised-terrain / hillside
  // track pieces. Confirmed empirically: terrain grid never exceeds 0x12, so
  // all elevation lives here in the track grid.
  if (id >= 0x80) return CATEGORY.ELEVATED

  return CATEGORY.ROAD
}

/**
 * @returns {{id:number, category:string, drivable:boolean, filler:boolean,
 *            empty:boolean, color:number, height:number}}
 */
export function describeElement(id) {
  const category = categoryForId(id)
  const empty = category === CATEGORY.EMPTY
  const filler = category === CATEGORY.FILLER
  const style = CATEGORY_STYLE[category] ?? CATEGORY_STYLE[CATEGORY.ROAD]
  return {
    id,
    category,
    empty,
    filler,
    drivable: !empty && !filler,
    color: style.color,
    height: style.height,
  }
}
