# Skyhook

A browser-based 3D action game. You're a soldier with a dual grappling-hook harness powered by compressed gas. Giants (4–15 m tall) have breached the wall of your city district. Swing between the buildings, build up speed, and cut each giant down with a strike to the small weak point on the back of its neck.

Built with Three.js and Vite. Every model, texture and sound is procedural or built from primitives, with no external assets. Inspired by *Attack on Titan*.

![Swinging through the plaza during wave 3](docs/screenshot-gameplay.jpg)

## Play

- **Online:** once GitHub Pages is enabled (see [Deploying](#deploying-to-github-pages)), the game is served at `https://<user>.github.io/<repo>/`.
- **Locally:** `npm install && npm run dev`, then open the printed URL.

Click **PLAY** to lock the mouse. **Esc** pauses.

## Controls

| Action | Default | Notes |
| --- | --- | --- |
| Fire left / right hook | **Left / Right mouse** | Fires toward the crosshair. **Hold** to reel that hook in (uses gas). |
| Gas boost | **Space** (hold) | Thrust toward your anchors. With no hooks attached it's an air dash; on the ground, a jump. |
| Release hooks | **Shift** | Let go and keep your momentum. |
| Air steering / walk | **W A S D** | Relative to the camera. |
| Slash | **E** | Tap to swing, or hold to keep the blades out for up to 0.45 s. |
| Swap blades | **R** | Uses one spare pair. |
| Struggle (when grabbed) | **Space** (mash) | Slashing counts double. |
| Pause | **Esc** | |
| Perf overlay | **F3** | FPS, draw calls, triangles, resolution scale. |

Every action except pause can be rebound (keyboard or mouse button) in **Settings**.

### How to play

1. Aim at a building. The crosshair ring lights up when an anchor is in range (95 m). Fire a hook, then hold its button to reel in.
2. Swing: rope tension turns your fall into a pendulum arc. Release (**Shift**) near the top of the arc and fire the other hook at the next building. **Space** adds thrust.
3. Giants die **only** from a cut to the nape, on the back of the neck and marked in dark red. Damage scales with your speed: a 4 m giant falls at ~14 m/s, but a 15 m giant needs a ~35 m/s pass with fresh blades.
4. Limb hits stagger giants. Enough damage severs the limb: a severed leg makes the giant crawl, and a severed arm can't grab. Limbs regrow after 18 s.
5. A giant that glows red is winding up. A HUD arrow points at it, labelled **GRAB!** or **SWIPE!**. Grabs come from the front, so stay behind or above. If you're grabbed, mash Space before it bites.
6. Blades dull with every strike, and damage falls off as they do. Swap with **R**.
7. Land on a **supply depot** (blue beacon, blue squares on the minimap) and stand still for a moment to refill gas and blades and patch up 35 HP.

## Features

**Grapple movement**
- Two independent hooks, each a projectile that anchors to buildings, towers, trees, the wall or the giants themselves (anchors on giants follow the moving body part).
- Rope physics: each rope is a max-length constraint with an auto-winch. Swinging is true pendulum motion with momentum preserved. Per-hook reel, gas boost toward the anchors, air dash, and a lift-off hop from the ground.
- A gas tank that drains on boost, reel and firing, with a low-gas warning.
- Third-person camera with smoothing, collision pull-in, FOV widening and speed lines at high speed, and trauma-based camera shake. Light aim assist.

**Combat**
- Dual blades with durability and 4 spare pairs. Slash damage scales with impact speed, blade sharpness and body part.
- A small nape weak point is the only kill zone. Limbs can be severed, the giant's body blocks you physically, and crashing into walls faster than 38 m/s hurts.
- Hit feedback: hit-stop, a slow-motion beat on kills, camera shake, floating damage numbers, a KILL banner with style tags, a screen flash, blade-arc trails, and steam and blood-mist particles.

**Giants**
- Procedural low-poly giants with randomized, uncanny proportions and faces.
- AI state machine: wander → detect (line of sight) → pursue → telegraphed grab or swipe → recover, with stagger interrupts. Obstacle avoidance lets them move through the street grid.
- Grab and escape: 35 damage plus crush damage, a mash-to-escape meter, and a bite if you're too slow.
- Variants: small, medium, large, and an **abnormal** that zigzags, twitches, sprints in bursts, winds up faster and always knows where you are.

**World**
- A seeded, procedural walled district: a street grid of plastered houses with tiled roofs and tall towers, a central plaza with a 64 m clock tower, open squares, a forest of giant trees on the northern edge, and a 50 m outer wall with a breach where giants pour in.
- Four supply depots with light-beam beacons.

**Game loop and UI**
- Wave mode: 10 escalating waves (large giants from wave 3, abnormals from wave 4), trickle spawns, intermissions, and victory.
- Scoring: kill value by variant, a speed bonus, style bonuses (AIRBORNE, ONE CUT, CLOSE CALL), combo multiplier, wave-clear and time bonuses. The best score is saved.
- Main menu with a live city backdrop, How to Play, a pause menu, and a results screen with run stats and score breakdown.
- Settings: mouse sensitivity, invert Y, graphics quality (low/medium/high), dynamic resolution, FOV effects, speed lines, volume, and full key rebinding. Saved to `localStorage`.
- HUD: health, gas and blade durability, spare blades, wave status, score and combo, speed, minimap, danger indicator, struggle meter, and resupply progress.

**Audio and polish**
- All sound is synthesized live with the Web Audio API: wind that rises with speed, gas hiss, hook zips, blade swishes, flesh impacts, steam, footsteps, roars, bells and more, all panned in stereo relative to the camera.
- Performance: instanced city, merged giant meshes, allocation-free hot paths, fog culling, texel-snapped shadows, and dynamic resolution to hold 60 fps.

## Build and run

Requires **Node.js 20+** (CI uses Node 22).

```bash
npm install        # install dependencies (three, vite, vitest)
npm run dev        # dev server with hot reload
npm test           # unit tests (Vitest)
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

The build uses a relative base path (`base: './'`), so `dist/` works from any sub-path, including a GitHub Pages project URL.

### Debug helpers

- `?autoplay` starts a run immediately and doesn't require pointer lock (handy for automated testing).
- `?fps` shows the perf overlay on load (same as **F3**).
- `window.__skyhook` exposes the `Game` instance in the browser console.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` runs the tests, builds, and publishes `dist/` to GitHub Pages on every push to `main` (it can also be run manually from the Actions tab). One-time setup:

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or run the "Deploy to GitHub Pages" workflow). The URL appears in the workflow summary.

`.github/workflows/ci.yml` runs tests and the build on every other branch push and on pull requests.

## Project structure

```
src/
  core/      fixed-step loop, input (keys and mouse as rebindable codes), settings, math, seeded RNG, perf monitor
  world/     city generator (pure data), static colliders + raycasts, Three.js city view, supply depots
  player/    kinematic player body, player model, third-person camera rig, crosshair aiming
  grapple/   pure rope math, hook state machine, grapple system (gas/reel/boost), rope rendering
  combat/    pure damage math, blades, slash resolution, hit feedback (numbers, banners, toasts)
  giants/    procedural rig + poses, giant entity, pure AI state machine, AI brain, manager
  game/      Game orchestrator, wave director, scoring
  ui/        HUD, minimap, menus, stylesheet
  audio/     procedural Web Audio engine
  fx/        particles, speed lines, slash trail
tests/       Vitest suites (rope physics, damage and combat, AI transitions, waves and scoring, colliders)
```

### Architecture

- **Loop:** physics and gameplay run at a fixed 120 Hz with render interpolation. Input is read once per frame before the physics steps. A time scale drives hit-stop and slow motion.
- **Per step:** player intent → hooks (fly / attach / reel) → integrate the player (gravity, gas, steering, quadratic drag) → rope constraints → collision against the world and giant bodies → giant AI and animation → slash resolution → events. Events feed audio, particles, HUD and scoring.
- **Physics:** the player is a sphere, and the world is axis-aligned boxes plus vertical cylinders on a uniform grid. Ropes are solved as position projection plus removal of outward radial velocity, which conserves tangential momentum (see `tests/ropeMath.test.js` for the pendulum period and energy checks).
- **Giants:** a bone hierarchy of `THREE.Group`s posed procedurally each step. Hitboxes are spheres in bone-local space, used for hook raycasts, slashes, body collision and grabs.

## Design decisions

- **Plain JavaScript + JSDoc** instead of TypeScript: less tooling, and the build stays a plain `vite build`.
- **Custom physics, no cannon-es.** The player is a kinematic sphere against axis-aligned boxes and vertical cylinders, so a hand-written solver is simpler and faster than a general physics engine.
- **Ropes are max-length constraints with an auto-winch.** A rope never lengthens. Slack is taken up automatically, so swinging is a pure pendulum that keeps its momentum. Ropes pass through geometry; there's no rope-wrapping.
- **Hold a hook button to reel that hook.** Clicking fires, holding reels (uses gas), Shift releases both. This keeps reeling per-hook without extra keys.
- **Lift-off hop:** reeling or boosting while standing on the ground pops the player into the air, so the rope swings them instead of dragging them along the floor.
- **Gas slowly regenerates only while standing still on the ground** (2.5/s), so an empty tank can never soft-lock a run. Supply depots refill it completely in 1.2 s.
- **Light aim assist:** if the crosshair ray misses, a small cone of probe rays (2°–4°) looks for a nearby anchor.
- **Crash damage:** hitting a surface faster than 38 m/s hurts, which rewards releasing before impact.
- **Slash is on `E`.** The mouse buttons belong to the hooks, so the slash needs its own key (rebindable).
- **Slash = short active window (0.14 s)** during which a 2.3 m sphere in front of the player is tested against giant hitboxes every physics step. Each giant can be hit once per slash, and the nape wins if it overlaps.
- **Damage = (10 + 3.2 × speed) × part multiplier × blade sharpness.** Nape health is 30 + 6 × height, so a 15 m giant needs a ~35 m/s pass with fresh blades to die in one cut, while a 4 m giant dies at ~14 m/s.
- **Giants are hitbox spheres on a procedural bone rig.** Hooks can anchor on any body part and follow it as it moves.
- **Severed limbs regrow after 18 s.** A severed leg cripples the giant (it crawls at 25 % speed); a severed arm can't grab.
- **Giants step over buildings shorter than 55 % of their height** and slide around taller ones. This avoids full pathfinding.
- **AI is a pure state machine** (`src/giants/aiStateMachine.js`) that returns the next state from a perception snapshot. The `GiantBrain` only executes behaviour, which keeps transitions unit-testable.
- **Grab over swipe:** when a grab is possible, giants close in to grab. They swipe only when the grab is on cooldown or the player is off to the side, and only at players high enough for the shoulder-level arc (in the air or on roofs).
- **Telegraphs:** windups last 0.95 s for grabs (0.55 s for abnormals) and 0.75 s for swipes. The giant pulses red and a HUD arrow points at it. Staggering a giant (any hit, or severing the attacking arm) cancels the windup.
- **Grab escape:** a grab deals 35 damage plus 4/s crush. Mash Space (a slash counts double) to break free before the 5 s bite (30 damage). Escaping grants 2.5 s of grab immunity.
- **Line of sight** is a throttled ray from the head (4 per second). Abnormals ignore it, and anything within 22 m is always "heard".
- **Steering** is probe-ray obstacle avoidance (a fan of headings around the goal) plus a stuck detector that forces a detour. There's no navmesh.
- **Ten waves, then victory.** Each wave grows in size and mix: large giants from wave 3, abnormals from wave 4. At most 7 giants are alive at once, and the rest trickle in every 2.5–5 s from the wall breach or the forest (whichever spawn points are more than 90 m from the player).
- **Healing:** supply depots also restore 35 HP, and clearing a wave restores 25 HP. Without this a 10-wave run would be decided by attrition rather than skill.
- **Scoring:** a kill scores the variant's base value plus a speed bonus (8 points per m/s above 20), plus style bonuses: AIRBORNE (≥ 4 s off the ground), ONE CUT, and CLOSE CALL (≤ 25 HP). Kills within 10 s of each other chain a combo multiplier (+0.25 each, capped at ×3). Wave clears add 250 × wave number plus a time bonus. Severs and escapes add small bonuses. The best score is kept in `localStorage`.
- **Resupply:** stand still on a depot platform for 1.2 s. There's no cooldown, since landing already costs you momentum.
- **Forgiving slashes at speed:** holding the slash key keeps the blades out for up to 0.45 s. If the nape will come into range within the next 0.08 s, the swing isn't spent on an arm or body part that happens to be closer first.
- **Kill beat:** a kill gets a hit-stop followed by 0.45 s of 35 % slow motion.
- **Audio is 100 % procedural** (Web Audio): wind and gas-hiss noise loops follow speed and boosting, and every effect is a small synthesized graph (filtered noise bursts, pitch-swept oscillators, LFO-modulated roars). There are no audio files. Distant sounds are attenuated and stereo-panned relative to the camera.
- **Performance:** instanced city geometry, each giant's per-bone meshes merged by material (~35 → ~15 draw calls), preallocated raycast results (no per-frame garbage in aiming), giants beyond the fog hidden, shadow frustum snapped to texels, and **dynamic resolution** that steps the pixel ratio down when frames exceed 20 ms and back up when there's headroom. Press **F3** (or add `?fps`) for an FPS / draw-call overlay.
- **No license file is included.** Choosing a license is left to the repository owner.

## Credits

Code, geometry, shaders and sound are all generated procedurally in this repository. The game concept is an homage to *Attack on Titan*; no names, characters, art or audio from it are used.
