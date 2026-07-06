# Raycast Vehicle Sample

[![Raycast vehicle demo](src/assets/demo.jpg)](https://raycast-rc-car.netlify.app/)

Interactive arcade car sample built with [three.js](https://threejs.org) and
[cannon-es](https://github.com/pmndrs/cannon-es). The car uses a
`CANNON.RaycastVehicle` chassis with GLB visuals, a GLB driving level,
post-processing effects, keyboard/touch/gamepad controls, and a live tuning
panel.

Play the live demo: <https://raycast-rc-car.netlify.app/>

The physics approach is inspired by [Bruno Simon's portfolio](https://bruno-simon.com/)
and [swift502/Sketchbook](https://github.com/swift502/Sketchbook): each wheel is
a suspension ray, while the GLB level is converted into static trimesh
colliders for ramps, loops, and walls.

## Run it

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Controls

### Keyboard

| Key | Action |
| --- | --- |
| W A S D / arrows | Drive and steer |
| Shift | Boost |
| Space | Jump / handbrake |
| R | Respawn |
| . (period) | Toggle the tuning panel |
| Mouse drag | Orbit the camera (scroll to zoom) |

### Touch (phones/tablets)

An on-screen joystick (right) drives and steers; the lightning button (left)
boosts. The tuning panel is hidden on touch devices.

### Gamepad

| Input | Action |
| --- | --- |
| Left stick / D-pad | Steer and drive |
| Right trigger | Gas |
| Left trigger | Brake / reverse |
| A (bottom button) | Jump |
| B / right bumper | Boost |

## How it works

- The chassis is a single `CANNON.Box` rigid body, with small corner spheres so
  it can collide with the level's `CANNON.Trimesh` (cannon-es trimeshes only
  generate contacts against spheres and planes, not boxes).
- Each wheel is a `CANNON.RaycastVehicle` wheel: a ray cast downward that acts
  as a spring/damper suspension and applies engine, brake, and friction forces
  at the contact point. There are no wheel collider bodies, which is what makes
  this technique stable and fast.
- The level (`src/assets/rc-level.glb`) is used for both rendering and physics:
  every mesh in it becomes an exact `CANNON.Trimesh` collider, so ramps and
  curved surfaces work without hand-made collision boxes.
- Three.js meshes are purely visual and get synced from the physics bodies each
  frame (`Vehicle._syncVisuals`, `World.update`).
- The chase camera smoothly interpolates toward a point behind the car using
  frame-rate-independent exponential damping, pulls back and widens the FOV
  while boosting, and lifts up when the car is airborne.
- A single post-processing pass handles color grading, vignette, chromatic
  aberration, film noise, and the wind-streak speed effect during boost.
- The sun's shadow camera follows the car and snaps to shadow-map texels to
  avoid shimmering shadow edges.

## Tuning the feel

Press `.` or use the **Vehicle Tuning** panel (top-right, lil-gui — closed by
default) to tweak everything live. It is organized into:

- **Vehicle** — engine, steering, brakes, suspension & tires, chassis,
  assists, and jump
- **Camera** — FOV and clipping
- **World** — environment height, teleporter, lighting & shadows
- **Effects** — post processing and tire marks
- **Models** — visual-only GLB transforms for the body and wheels
- **Debug** — FPS readout and physics collider wireframes

"Reset to defaults" restores the shipped values.

Defaults live in `DEFAULT_PARAMS` at the top of `src/Vehicle.js`. Highlights:

- `engineForce`, `boostMultiplier`, `cruiseSpeedKmh`, `maxSpeedKmh` —
  acceleration and top speed (with and without boost)
- `maxSteer`, `steerSpeed` — how sharp and how quickly the car steers
- `frictionSlip` — grip (lower = more drifty)
- `suspensionStiffness` / `suspensionRestLength` — ride height and bounce
- `jumpImpulse`, `airborneGravityScale` — jump height and how floaty it feels
- `inertiaScale`, `antiWheelie`, `tiltClampAirborne`, `uprightAssist`,
  `wallSlideAssist` — the arcade stability assists

## Project structure

```
index.html          HUD, mobile controls, and styles
src/main.js         Renderer, camera, post-processing, GUI, input, game loop
src/Vehicle.js      Car physics, controls, visuals, tire marks
src/World.js        Level loading, trimesh colliders, lights and shadows
src/assets/         Car and level GLBs + reflection texture
```

## Gotchas worth knowing (cannon-es)

1. `CANNON.Trimesh` only collides with spheres and planes. The car's box
   chassis gets four embedded corner spheres so it can hit trimesh walls.
2. Rays fail against rotated `CANNON.Plane` bodies — use boxes or trimeshes
   for the ground instead.
3. A body's AABB is computed once at construction; `position.set()` after
   construction leaves it stale, and rays are broadphase-culled against that
   stale AABB. Call `body.updateAABB()` after placing static bodies.
