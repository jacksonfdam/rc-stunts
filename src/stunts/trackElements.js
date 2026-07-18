/**
 * Classification of Stunts `.TRK` track-tile ids into renderable elements.
 *
 * The id→piece table is the authoritative one cross-verified from
 * `duplode/stunts-cartography` (`src/Track.hs`, a reverse-engineered decoder)
 * and `wiki.stunts.hu/wiki/Track_file`. Every id 0x00–0xB5 plus the filler
 * bytes is high-confidence; 0xB6–0xFC are internal render artifacts, not
 * placeable pieces, and are treated as empty.
 *
 * IMPORTANT: ids >= 0x97 are mostly *scenery and buildings* (palm/pine/cactus,
 * gas station, barn, …) that sit on the grass and do NOT form the racing
 * surface. An earlier pass wrongly rendered everything >= 0x80 as raised road.
 * The real elevated/ramp pieces are 0x22–0x27 and 0x5F–0x72.
 *
 * Surface (paved/dirt/icy) only changes texture/friction, never geometry, so
 * the renderer shares one mesh shape across each surface triple.
 */

import { FILLERS } from './TrackFile.js'

export const CATEGORY = {
  EMPTY: 'empty',
  FILLER: 'filler',
  ROAD: 'road',
  CORNER: 'corner',
  RAMP: 'ramp',
  ELEVATED: 'elevated',
  ELEVATED_CORNER: 'elevatedCorner',
  BANKED: 'banked',
  LOOP: 'loop',
  PIPE: 'pipe',
  TUNNEL: 'tunnel',
  CHICANE: 'chicane',
  JUNCTION: 'junction',
  CORKSCREW: 'corkscrew',
  HIGHWAY: 'highway',
  START: 'start',
  SCENERY: 'scenery',
  BUILDING: 'building',
  UNKNOWN: 'unknown',
}

export const SURFACE = { PAVED: 'paved', DIRT: 'dirt', ICE: 'ice', NONE: 'none' }

// Racing-surface tint per surface; geometry is shared across the triple.
const SURFACE_COLOR = {
  [SURFACE.PAVED]: 0x44454b,
  [SURFACE.DIRT]: 0x8a6a43,
  [SURFACE.ICE]: 0xbfe6f2,
  [SURFACE.NONE]: 0x55565c,
}

// Non-road accent colours by category (used when surface is NONE).
const CATEGORY_COLOR = {
  [CATEGORY.RAMP]: 0x6d5a34,
  [CATEGORY.ELEVATED]: 0x5b6470,
  [CATEGORY.ELEVATED_CORNER]: 0x5b6470,
  [CATEGORY.BANKED]: 0x7a5a8a,
  [CATEGORY.LOOP]: 0xdb2777,
  [CATEGORY.PIPE]: 0x0891b2,
  [CATEGORY.TUNNEL]: 0x334155,
  [CATEGORY.CORKSCREW]: 0xea580c,
  [CATEGORY.HIGHWAY]: 0x3f3f46,
  [CATEGORY.START]: 0xd4d4d8,
  [CATEGORY.FILLER]: 0x44454b,
}

// Ordered range table. Each entry: [lo, hi, category, surface, size]. `lo` and
// `hi` are inclusive. Orientation is derived from (id - lo) at lookup time.
// `size` is the footprint in tiles for the anchor cell (fillers cover the rest).
const S = SURFACE
const C = CATEGORY
const RANGES = [
  [0x01, 0x03, C.START, S.PAVED, 1], // start/finish + ghost starts
  [0x04, 0x05, C.ROAD, S.PAVED, 1],
  [0x06, 0x09, C.CORNER, S.PAVED, 1], // sharp 1×1
  [0x0a, 0x0d, C.CORNER, S.PAVED, 2], // large 2×2
  [0x0e, 0x0f, C.ROAD, S.DIRT, 1],
  [0x10, 0x13, C.CORNER, S.DIRT, 1],
  [0x14, 0x17, C.CORNER, S.DIRT, 2],
  [0x18, 0x19, C.ROAD, S.ICE, 1],
  [0x1a, 0x1d, C.CORNER, S.ICE, 1],
  [0x1e, 0x21, C.CORNER, S.ICE, 2],
  [0x22, 0x23, C.ELEVATED, S.NONE, 1], // raised straight
  [0x24, 0x27, C.RAMP, S.NONE, 1], // incline
  [0x28, 0x2f, C.BANKED, S.NONE, 1], // banked transitions
  [0x30, 0x33, C.BANKED, S.NONE, 1], // banked straight
  [0x34, 0x37, C.BANKED, S.NONE, 1], // banked corner
  [0x38, 0x3b, C.RAMP, S.NONE, 1], // bridge ramp
  [0x3c, 0x3f, C.CHICANE, S.PAVED, 1],
  [0x40, 0x41, C.LOOP, S.NONE, 2],
  [0x42, 0x43, C.TUNNEL, S.NONE, 1],
  [0x44, 0x45, C.PIPE, S.NONE, 1],
  [0x46, 0x49, C.PIPE, S.NONE, 1], // pipe transition
  [0x4a, 0x4a, C.JUNCTION, S.PAVED, 1], // crossroad
  [0x4b, 0x52, C.JUNCTION, S.PAVED, 1], // sharp splits
  [0x53, 0x54, C.PIPE, S.NONE, 1], // pipe obstacle
  [0x55, 0x56, C.CORKSCREW, S.NONE, 1],
  [0x57, 0x5e, C.JUNCTION, S.NONE, 2], // large splits
  [0x5f, 0x62, C.RAMP, S.NONE, 1], // solid ramp
  [0x63, 0x64, C.ELEVATED, S.NONE, 1], // solid road
  [0x65, 0x68, C.ELEVATED, S.NONE, 1], // span / elevated span
  [0x69, 0x6c, C.ELEVATED_CORNER, S.NONE, 1],
  [0x6d, 0x6e, C.HIGHWAY, S.NONE, 1],
  [0x6f, 0x72, C.HIGHWAY, S.NONE, 1], // highway transition
  [0x73, 0x74, C.CHICANE, S.NONE, 1], // slalom
  [0x75, 0x7c, C.CORKSCREW, S.NONE, 1], // corkscrew up-down
  [0x7d, 0x7d, C.JUNCTION, S.DIRT, 1],
  [0x7e, 0x85, C.JUNCTION, S.DIRT, 1],
  [0x86, 0x89, C.START, S.DIRT, 1],
  [0x8a, 0x8a, C.JUNCTION, S.ICE, 1],
  [0x8b, 0x92, C.JUNCTION, S.ICE, 1],
  [0x93, 0x96, C.START, S.ICE, 1],
  [0x97, 0x9a, C.SCENERY, S.NONE, 1], // palm / cactus / pine / tennis
  [0x9b, 0xb2, C.BUILDING, S.NONE, 1], // gas station … Joe's diner
  [0xb3, 0xb5, C.START, S.PAVED, 1],
]

// Which scenery prop each 0x97–0x9A id is (for prop rendering).
export const SCENERY_KIND = { 0x97: 'palm', 0x98: 'cactus', 0x99: 'pine', 0x9a: 'tennis' }

const DRIVABLE_CATEGORIES = new Set([
  C.ROAD, C.CORNER, C.RAMP, C.ELEVATED, C.ELEVATED_CORNER, C.BANKED, C.LOOP,
  C.PIPE, C.TUNNEL, C.CHICANE, C.JUNCTION, C.CORKSCREW, C.HIGHWAY, C.START, C.FILLER,
])

function lookupRange(id) {
  for (const r of RANGES) if (id >= r[0] && id <= r[1]) return r
  return null
}

/**
 * @returns {{id:number, category:string, surface:string, orient:number,
 *   size:number, drivable:boolean, empty:boolean, filler:boolean,
 *   prop:boolean, sceneryKind:?string, fillerCorner:?string,
 *   color:number}}
 */
export function describeElement(id) {
  if (id === 0x00) {
    return base(id, C.EMPTY, S.NONE, 0, 1, { empty: true })
  }
  if (FILLERS.has(id)) {
    // Continuation cell of a multi-tile piece. Render as flat road so the
    // piece's footprint stays gapless and drivable; the corner it fills is
    // recorded in case a later pass wants exact multi-tile geometry.
    const corner = id === 0xff ? 'NE' : id === 0xfe ? 'SW' : 'SE'
    return base(id, C.FILLER, S.PAVED, 0, 1, { filler: true, fillerCorner: corner })
  }

  const range = lookupRange(id)
  if (!range) {
    // 0xB6–0xFC and any gap: internal render artifacts, not real pieces.
    return base(id, C.UNKNOWN, S.NONE, 0, 1, { empty: true })
  }

  const [lo, , category, surface, size] = range
  const orient = (id - lo) % 4
  return base(id, category, surface, orient, size, {})
}

function base(id, category, surface, orient, size, flags) {
  const empty = flags.empty ?? false
  const filler = flags.filler ?? false
  const prop = category === CATEGORY.SCENERY || category === CATEGORY.BUILDING
  const drivable = !empty && !prop && DRIVABLE_CATEGORIES.has(category)
  const color =
    surface !== SURFACE.NONE
      ? SURFACE_COLOR[surface]
      : CATEGORY_COLOR[category] ?? SURFACE_COLOR[SURFACE.NONE]
  return {
    id,
    category,
    surface,
    orient,
    size,
    empty,
    filler,
    prop,
    sceneryKind: SCENERY_KIND[id] ?? null,
    fillerCorner: flags.fillerCorner ?? null,
    drivable,
    color,
  }
}
