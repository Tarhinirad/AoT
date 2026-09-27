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
