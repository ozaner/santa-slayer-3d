# Santa Slayer 3D

A Quake-style arena shooter where Santa fights the gingerbread uprising.

It's a remake of [**SantaSlayer**](https://github.com/ozaner/SantaSlayer) — a 2D
Java platformer where Santa throws presents at gingerbread men — reimagined as a
first-person shooter. Same cast, same end-of-level flagpole. Everything else is
new, because a straight port of a 2D platformer would have been boring.

Runs in a browser. No game engine, no asset files: every model, texture and
sound in it is generated at runtime from code.

## Play

```bash
npm install
```

```bash
npm run dev
```

| | |
|---|---|
| Move | `W` `A` `S` `D` |
| Jump / bunny hop | `SPACE` (hold it) |
| Crouch | `CTRL` |
| Fire | `MOUSE 1` |
| Weapons | `1`–`4`, mouse wheel, or `Q`/`E` |
| Pause | `ESC` |

**Movement is the game.** It's Quake 3 / CPMA physics: hold jump to bunny hop,
and strafe-jump — hold `A` or `D` alone while sweeping the mouse the same way —
to accelerate past the walking cap. Ground speed tops out at 8.4 m/s; a good
strafe jumper sustains twice that. The speedometer at the bottom of the screen is
there so you can feel it working. Rocket-jumping with the Present Launcher costs
about 18 health and puts you on a rooftop.

## The arsenal

| Weapon | Role |
|---|---|
| **Blizzard Cannon** | Spinning-barrel snowball minigun. Your starting weapon, always something in the tank. |
| **Peppermint Twin-Bore** | Double-barrelled candy-cane shotgun. Deletes anything inside five metres. |
| **Present Launcher** | Wrapped presents that explode in a shower of ribbon. Splash damage, knockback, rocket jumps. |
| **Icicle Rail** | Frost-ring accelerator. 110 damage, pierces three targets. |

## The opposition

Gingerbread **Grunts** rush you. Candy-cane **Duelists** are fast and lunge.
**Gumdrop Bulwarks** carry a peppermint shield that soaks 88% of frontal damage —
flank them or splash them. **Frostbite Brutes** lob arcing snowballs from range.
The **Gingerbread Golem** is five metres of cracked dough with burning eyes that
summons reinforcements as it loses health.

## Levels

1. **The North Pole Village** — open snowy arena. Walkable gingerbread rooftops,
   connecting bridges, a frozen pond that takes your friction away, candy-cane
   jump pads. Five waves.
2. **Santa's Workshop** — tight, warm and vertical. Conveyors, catwalks, crate
   stacks. Short sightlines favour the shotgun.
3. **The Sleigh Yard** — boss arena. Just you, an ice rink, and the Golem.

Clear every wave and the flagpole lights up. Touch it to finish the level — the
one mechanic carried over intact from the original.

## Under the hood

- **Movement** is a port of the Q3/CPMA model into metres: swept-AABB traces
  against a spatial hash of brushes, Quake's plane-clipping slide move, stair
  stepping, air acceleration with a wish-speed clamp, and CPM air control.
- **No assets.** Textures are painted to canvases at load and turned into normal
  maps with a Sobel pass. Models are lathes, extrusions and tubes. The sky is a
  shader with aurora and stars. Sounds are WebAudio oscillators; the score is a
  generative *Carol of the Bells* ostinato that gets busier when you're in
  trouble.
- **Performance.** Procedural models are hundreds of small primitives, so the
  static ones get baked into one mesh per material at load time
  (`src/render/optimize.js`), and only the nearest few enemies cast shadows.
  Quality presets in Settings scale shadows, resolution and the light budget.

Tests for the physics, movement and combat maths:

```bash
npm test
```

Developer notes and the invariants worth knowing are in [AGENTS.md](AGENTS.md).
