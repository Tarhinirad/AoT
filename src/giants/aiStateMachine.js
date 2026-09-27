/**
 * Pure giant AI state machine. `nextState(state, ctx)` decides transitions
 * from a snapshot of perception; the Brain (ai.js) executes behaviours.
 *
 *   WANDER ──see──▶ PURSUE ──in reach──▶ GRAB_WINDUP ──▶ GRAB ──hit──▶ HOLD
 *     ▲               │  ╲                                  │miss        │escaped / done
 *     └──lost─────────┘   ╲──close──▶ SWIPE_WINDUP ─▶ SWIPE ─┴──▶ RECOVER ◀┘
 *   Abnormal giants may break into SPRINT from PURSUE. Any hit that staggers
 *   the giant interrupts its current action (STAGGER), except while holding.
 */
export const AI = Object.freeze({
  WANDER: 'wander',
  PURSUE: 'pursue',
  SPRINT: 'sprint',
  GRAB_WINDUP: 'grabWindup',
  GRAB: 'grab',
  HOLD: 'hold',
  SWIPE_WINDUP: 'swipeWindup',
  SWIPE: 'swipe',
  RECOVER: 'recover',
  STAGGER: 'stagger',
});

export const AI_TIMING = {
  grabWindup: 0.95,
  grabWindupAbnormal: 0.55,
  grab: 0.4,
  swipeWindup: 0.75,
  swipe: 0.45,
  recover: 1.3,
  holdMax: 5.0,
  sprintMax: 2.6,
  lostTimeout: 6,
  grabCooldown: 4,
  swipeCooldown: 2.5,
  sprintChance: 0.35, // per decision (abnormal only)
};

/**
 * @param {string} state current state
 * @param {object} c perception snapshot:
 *   t            time spent in the current state (s)
 *   canSee       player detected this tick
 *   lostTime     seconds since the player was last seen
 *   dist         distance from the giant's shoulders to the player
 *   grabRange, swipeRange
 *   grabReady, swipeReady  cooldowns elapsed
 *   hasArm       at least one arm attached
 *   inFront      player is within the frontal grab cone
 *   reachable    player is not above the giant's reach
 *   swipeable    player is high enough for the shoulder-level swipe arc
 *   playerHeld   the player is already held by some giant
 *   staggered    the giant is currently staggered
 *   grabHit      the grab connected this tick (GRAB state)
 *   released     the player escaped / was dropped (HOLD state)
 *   abnormal     erratic variant
 *   roll         uniform random in [0,1) for stochastic choices
 * @returns {string} next state
 */
export function nextState(state, c) {
  if (state !== AI.HOLD && state !== AI.STAGGER && c.staggered) return AI.STAGGER;
  const T = AI_TIMING;
  switch (state) {
    case AI.WANDER:
      return c.canSee ? AI.PURSUE : AI.WANDER;

    case AI.PURSUE: {
      if (!c.canSee && c.lostTime > T.lostTimeout) return AI.WANDER;
      const attack = chooseAttack(c);
      if (attack) return attack;
      if (c.abnormal && c.canSee && c.dist > c.swipeRange * 2 && c.roll < T.sprintChance * 0.02) return AI.SPRINT;
      return AI.PURSUE;
    }

    case AI.SPRINT: {
      const attack = chooseAttack(c);
      if (attack) return attack;
      if (c.t >= T.sprintMax) return AI.PURSUE;
      return AI.SPRINT;
    }

    case AI.GRAB_WINDUP: {
      const windup = c.abnormal ? T.grabWindupAbnormal : T.grabWindup;
      if (!c.hasArm) return AI.RECOVER;
      return c.t >= windup ? AI.GRAB : AI.GRAB_WINDUP;
    }

    case AI.GRAB:
      if (c.grabHit) return AI.HOLD;
      return c.t >= T.grab ? AI.RECOVER : AI.GRAB;

    case AI.HOLD:
      if (c.released || c.t >= T.holdMax) return AI.RECOVER;
      return AI.HOLD;

    case AI.SWIPE_WINDUP:
      if (!c.hasArm) return AI.RECOVER;
      return c.t >= T.swipeWindup ? AI.SWIPE : AI.SWIPE_WINDUP;

    case AI.SWIPE:
      return c.t >= T.swipe ? AI.RECOVER : AI.SWIPE;

    case AI.RECOVER:
      return c.t >= T.recover ? (c.canSee ? AI.PURSUE : AI.WANDER) : AI.RECOVER;

    case AI.STAGGER:
      if (c.staggered) return AI.STAGGER;
      return c.canSee || c.lostTime < T.lostTimeout ? AI.PURSUE : AI.WANDER;

    default:
      return AI.WANDER;
  }
}

/**
 * Grab when the player is in front and within reach. If a grab is possible
 * soon (ready, in front) the giant keeps closing in instead of swiping; it
 * swipes when the grab is on cooldown or the player is off to the side.
 */
function chooseAttack(c) {
  if (!c.canSee || c.playerHeld || !c.hasArm || !c.reachable) return null;
  const grabPossible = c.grabReady && c.inFront;
  if (grabPossible && c.dist <= c.grabRange) return AI.GRAB_WINDUP;
  if (!grabPossible && c.swipeReady && c.swipeable !== false && c.dist <= c.swipeRange) return AI.SWIPE_WINDUP;
  return null;
}

/** States in which the giant is winding up an attack (telegraph). */
export function isWindup(state) {
  return state === AI.GRAB_WINDUP || state === AI.SWIPE_WINDUP;
}

/* ---------------------------- grab escape ---------------------------- */

export const GRAB_ESCAPE = {
  initialDamage: 35,
  crushDps: 4,
  biteDamage: 30,
  decay: 1.6, // progress lost per second
  base: 9, // presses needed for a tiny giant
  perMeter: 0.5, // extra presses per meter of giant height
  slashValue: 2, // a slash counts as this many presses
};

export function escapeRequired(height) {
  return Math.round(GRAB_ESCAPE.base + height * GRAB_ESCAPE.perMeter);
}

/**
 * Advance escape progress.
 * @returns {{progress:number, escaped:boolean}}
 */
export function struggle(progress, presses, dt, required) {
  let p = Math.max(0, progress - GRAB_ESCAPE.decay * dt) + presses;
  const escaped = p >= required;
  if (escaped) p = required;
  return { progress: p, escaped };
}
