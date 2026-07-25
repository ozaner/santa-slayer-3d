# Santa Slayer 3D — working notes

A Quake-style arena FPS remake of [ozaner/SantaSlayer](https://github.com/ozaner/SantaSlayer),
a 2D Java platformer where Santa throws presents at gingerbread men. This is a
first-person reinterpretation: same cast, same flagpole ending, completely
different game.

## Hard rules for this repo

**No asset files. Ever.** There are no `.png`, `.glb`, `.wav` or `.mp3` files and
there must never be. Every model, texture, and sound is generated at runtime:

- geometry → `src/models/*.js` built from primitives in `src/render/materials.js`
- textures → canvas painting + a Sobel pass for normal maps (`materials.js`)
- audio → WebAudio oscillators and noise buffers (`src/audio/audio.js`)

If you need a new surface, add it to `materials.js`. If you need a new prop, add
a builder to `src/models/props.js`.

**Colour space.** `new THREE.Color(hex)` decodes sRGB into linear working space.
The canvas textures are tagged `SRGBColorSpace`, so any colour written into
`ImageData` must go back through `putColor()` in `materials.js` first. Writing
`c.r * 255` directly gamma-decodes twice and crushes the texture to near-black —
this bug cost an afternoon; do not reintroduce it.

**userData cannot hold Object3D references across a clone.** three's
`Object3D.copy()` deep-copies `userData` via `JSON.stringify`, which throws on
the circular object graph. Anything cloned at runtime (enemies, projectiles,
pickups) must go through `cloneRig()` in `src/models/rig.js`, which names the
parts, sanitises `userData`, and rebuilds the parts map on the copy.

**Never change how many point lights are visible.** three.js bakes the light
counts into every material's program cache key, so one light appearing or
vanishing recompiles *every shader in the scene*. Measured: 376 ms for an
explosion, **7.8 seconds** for a rocket that added its own light. `View` therefore
allocates a fixed pool (`LEVEL_LIGHT_SLOTS + FX_LIGHT_SLOTS`) once, every light
stays `visible: true` forever, and "off" means `intensity = 0`. Never call
`scene.add(new PointLight(...))` during gameplay, never toggle `light.visible`,
and if you need a light for an effect, borrow one via `fx.acquireProjLight()` or
`fx.flash()`.

Related: `Game.warmupShaders()` runs the real spawn and fire paths behind the
loading screen and draws one composed frame, because `renderer.compile()` alone
misses shadow-depth variants and pooled effect materials that have never been
drawn.

**Levels validate themselves.** `LevelBuilder.finish()` throws if any spawn
point, pickup or jump pad is inside a solid brush. Do not weaken this into a
warning or a runtime nudge — a buried pickup is invisible in play but instantly
obvious in the error. Fix the coordinate.

**Jump pads take a `target`, not a `push`.** The arc is solved so the player
lands on the named point with `clearance` to spare. Hand-tuned pushes are how
the first version flung players to 5.5 m at bridges whose decks were at 5.85 m.
If a pad sits close to the platform it feeds, raise `clearance` — a shallow arc
clips the platform's *edge* on the way up, which looks exactly like a dead pad.

## Layout

```
src/core/       physics.js (swept AABB, brushes, slide/step moves), pmove.js (Q3 movement)
src/game/       game.js (loop, waves, camera), weapons.js, enemies.js, pickups.js,
                combat.js (ray/capsule maths), level.js (LevelBuilder), levels/*
src/models/     santa.js, gingerbread.js, weapons.js, props.js, rig.js
src/render/     materials.js, view.js (renderer + post), fx.js (particles), sky.js, optimize.js
src/audio/      audio.js
src/ui/         hud.js   (markup and CSS live in index.html)
test/           node:test suites for the pure-logic modules
```

`src/core/physics.js` and `src/core/pmove.js` are deliberately three.js-free and
purely numeric, so the whole movement model runs under `node --test`. Keep them
that way — they operate on anything with `.x/.y/.z`, which `THREE.Vector3`
satisfies.

## Running it

Route 127 owns the port (see the global rules). The island id is in
`route127.json`; never write a port or URL into this repo.

```bash
curl -s -X POST "$ROUTE127_API/api/apps/santa-slayer-3d/start"
```

```bash
npm test
```

## Testing without a visible browser

The pane this project is usually developed in does not composite, so
`requestAnimationFrame` never fires and screenshots are unavailable. Two
affordances exist for that:

- `window.SS` (defined in `main.js`) exposes `game`, `view`, `fx`, `input`, plus
  `SS.run(n, dt)` (simulate + render), `SS.sim(n, dt)` (simulate only, ~200×
  faster) and `SS.shot(name)`.
- `SS.shot(name)` renders one frame and POSTs the canvas to `/__shot`, a
  **dev-server-only** middleware in `vite.config.js` that writes
  `shots/<name>.png`. Read that file to actually look at the game.

Note `SS.shot` captures the WebGL canvas only — the HUD is DOM, so assert on it
by reading element text instead.

## Things that bit, worth remembering

- `PerspectiveCamera.fov` is **vertical**. The FOV setting is horizontal (what
  players mean); `View.setFov` converts through the aspect and re-derives it on
  resize.
- `exponentialRampToValueAtTime(0)` throws. Every WebAudio voice guards its gain.
- A `0/0` in the enemy gait maths produced `NaN`, which propagated through
  `matrixWorld` and made whole models silently vanish. Guard divisors.
- A 0-size canvas gives `aspect = NaN` and the same silent blanking.
- Draw calls, not triangles, are the budget. The models are dozens of primitives
  each; `src/render/optimize.js` bakes rigidly-attached meshes into one mesh per
  material (`mergeRig` for characters, `mergeProp` for props). This took the
  worst case from 12.5k calls / 23 fps to 4.0k / 69 fps. Anything animated must
  be listed in `userData.parts` or it will be baked into the static batch.
