# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Requires Node.js 20+. There is no test suite or linter. The only config is
`vite.config.js`, which declares the **multipage build** (two HTML entries —
see below); everything else is Vite defaults.

```bash
npm install
npm run dev      # Vite dev server at http://localhost:5173
npm run build    # production build to dist/ (both pages)
npm run preview  # serve the built dist/
```

Two pages are served:
- `/` (`index.html`) — the Stunts (1990) web port (the deployed landing page).
- `/play.html` — the arcade RC playground.

Verifying changes means driving the car in the browser (`npm run dev`); there
are no automated tests to run.

## Architecture

An arcade RC-car playground: a `three.js` scene rendered on top of a `cannon-es`
`RaycastVehicle` physics simulation, plus a web port of Stunts (1990) built on
the same engine. Two independent entry points (`play.html` → `src/main.js`,
`index.html` → `src/stunts/main.js`) share the vehicle/level engine
(`Vehicle.js`, `World.js`).

### The two-representation model

Every game object exists twice and is kept in sync each frame:
- **Physics** (`cannon-es`, authoritative) — bodies stepped at a fixed 60 Hz.
- **Visual** (`three.js`, presentational) — meshes copied from the physics
  transforms every render frame.

Sync direction is always physics → visuals, using the body's *interpolated*
transform (`Vehicle._syncVisuals`, `World.update`) to avoid stutter when the
render rate (e.g. 120 Hz) differs from the fixed physics step.

### File responsibilities

- **`src/main.js`** — the composition root and game loop. Owns the renderer,
  scene, chase camera, post-processing chain, lil-gui tuning panel, input
  (keyboard is bound inside `Vehicle`; gamepad, mouse-orbit, mobile joystick,
  and the transporter live here), and the `tick()` loop. Instantiates one
  `World` and one `Vehicle`.
- **`src/Vehicle.js`** — the car: physics body + raycast wheels, control logic,
  arcade stability assists, GLB visual loading, and tire marks. All tunables
  live in the exported `DEFAULT_*` constants at the top.
- **`src/World.js`** — the level: loads `rc-level.glb` twice (once for
  rendering, once to generate `CANNON.Trimesh` colliders from every mesh), plus
  hemisphere + directional (sun) lighting and shadow setup.
- **`src/stunts/`** — the Stunts (1990) web port (independent of `World.js`,
  reuses `Vehicle.js`):
  - **`main.js`** — its own composition root and game loop: scene/sky/horizon,
    car + driver selection (16-car roster with bonus coefficients), the AI
    opponent ghost car + race position, procedural engine sound, camera view
    cycling (chase/hood/cockpit), run timer, and results screen.
  - **`TrackFile.js`** — binary `.TRK` parser (the original file format) →
    a grid of element byte-ids.
  - **`StuntsTrack.js`** — turns a parsed `.TRK` into drivable 3D geometry and
    `CANNON.Trimesh` colliders per tile (roads, ramps, elevated bridges,
    neighbour-derived curved corners, loops with a stick-to-surface assist),
    plus start/finish line and the opponent's lap route.
  - **`trackElements.js`** — the authoritative element table mapping `.TRK`
    byte-ids to track pieces (ids ≥ 0x80 are scenery, not road).
  - **`tracks/`** — 84 original `.TRK` files, resolved via `import.meta.glob`.

### The game loop (`main.js` `tick()`)

Order matters: `physicsWorld.step()` → gamepad poll → `vehicle.update(delta)` →
`world.update()` → `updateCamera` → `updateTransporter` → shadow-camera follow →
HUD/boost blends → render (`composer.render()` when post is on, else
`renderer.render()`).

### Vehicle physics technique (RaycastVehicle)

Inspired by Bruno Simon's portfolio and swift502/Sketchbook. Key facts, several
of which are non-obvious cannon-es gotchas:

- The chassis is a single `CANNON.Box` **plus four embedded corner spheres**.
  A `CANNON.Trimesh` (the level collider) only generates contacts against
  spheres and planes, *not* boxes — the spheres are what let the car hit trimesh
  walls and ramps at all.
- Each wheel is a downward suspension **ray**, not a collider body. There are no
  wheel bodies; this is what makes the technique stable and fast.
- The physics box is deliberately shorter than the visual body (`PHYSICS_HALF`
  vs `CHASSIS_SIZE`) so the wheels reach ramps before the body scrapes.
- After moving any static body via `position.set(...)`, call `body.updateAABB()`
  — cannon caches broadphase bounds at construction and rays are culled against
  the stale AABB otherwise (see `World.applyEnvironmentParams`).
- Meshes above 32767 vertices are skipped for colliders (cannon Trimesh indices
  are Int16). See `World._addTrimeshColliderShape`.

### Params & the tuning panel

Nearly every feel value is a live-tunable field. The pattern throughout:

- Each subsystem exports a `DEFAULT_*_PARAMS` object and holds a mutable copy
  (e.g. `vehicle.params`, `vehicle.tireMarkParams`, `world.environmentParams`,
  `postParams`, `shadowParams` in main.js).
- lil-gui controllers mutate those copies in place. Changes that must be pushed
  into the physics engine or materials call an `apply*()` method
  (`applyChassisParams`, `applyWheelParams`, `applyBodyModelParams`,
  `applyTireMarkParams`, `applyReflectionParams`, `world.applyEnvironmentParams`,
  and the `applyPostParams`/`applyShadowParams`/`applyCameraParams` in main.js).
- **When adding a tunable:** add it to the relevant `DEFAULT_*` object, add a
  lil-gui control in `main.js`, wire `.onChange` to the matching `apply*()` if
  the value needs propagating, and add it to the `resetParams` action in
  `main.js` so "Reset to defaults" restores it.

Press `.` (period) to toggle the panel; it is hidden by default and on touch devices.

### Arcade assists (`Vehicle._applyAssists`)

The raw raycast vehicle flips and yanks unrealistically, so a stack of assists
tames it: grip load-cap + landing grip fade-in, wall-slide assist, airborne
extra gravity, airborne tilt clamp, corner-lift damping, and an upright/righting
assist. Each is individually toggleable/tunable and commented with *why* it
exists — read those comments before changing handling feel.

### Assets & loading

- GLBs are imported with Vite's `?url` suffix (`import x from './a.glb?url'`) so
  they resolve in both dev and build.
- Model loading is resilient: if a GLB is missing or has no meshes, the code
  logs a warning and keeps the procedural placeholder boxes/cylinders, so the
  car is always drivable. Models are auto-centered and scaled to match the
  physics constants (`fitModel`), then GUI transforms stack on top.
- `main.js` uses top-level `await` (`await world.ready`, reflection maps) — the
  module relies on ESM top-level await support.

### Rendering notes

- MSAA on the default framebuffer only applies with post-processing off; the
  `EffectComposer` path sets `samples = 4` on its own render targets.
- Post chain: `RenderPass` → `GTAOPass` (off by default) → custom
  `colorGradeShader` `ShaderPass` (grade + vignette + chromatic aberration +
  film noise + boost wind-streaks) → `OutputPass`.
- The sun's shadow camera follows the car and snaps to shadow-map texel
  increments each frame (`tick()`) to stop shadow edges shimmering while driving.
