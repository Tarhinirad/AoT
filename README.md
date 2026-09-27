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
