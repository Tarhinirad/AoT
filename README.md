# Skyhook

A browser-based 3D action game: swing through a walled city on a dual grappling-hook harness and cut down giants at the nape of the neck.

_Work in progress. Full docs are added in M7._

## Design decisions

- **Plain JavaScript + JSDoc** instead of TypeScript: less tooling, and the build stays a plain `vite build`.
- **Custom physics, no cannon-es.** The player is a kinematic sphere against axis-aligned boxes and vertical cylinders, so a hand-written solver is simpler and faster than a general physics engine.
- **Ropes are max-length constraints with an auto-winch.** A rope never lengthens. Slack is taken up automatically, so swinging is a pure pendulum that keeps its momentum. Ropes pass through geometry; there's no rope-wrapping.
- **Hold a hook button to reel that hook.** Clicking fires, holding reels (uses gas), Shift releases both. This keeps reeling per-hook without extra keys.
- **Lift-off hop:** reeling or boosting while standing on the ground pops the player into the air, so the rope swings them instead of dragging them along the floor.
- **Gas slowly regenerates only while standing still on the ground** (2.5/s), so an empty tank can never soft-lock a run. Supply depots refill instantly.
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
