import { describe, it, expect } from 'vitest';
import { AI, AI_TIMING, nextState, isWindup, escapeRequired, struggle, GRAB_ESCAPE } from '../src/giants/aiStateMachine.js';

const base = (over = {}) => ({
  t: 0, canSee: false, lostTime: 99, dist: 100, grabRange: 8, swipeRange: 10,
  grabReady: true, swipeReady: true, hasArm: true, inFront: true, reachable: true,
  playerHeld: false, staggered: false, grabHit: false, released: false, abnormal: false, roll: 0.5,
  ...over,
});

describe('wander / detect / pursue', () => {
  it('wanders until the player is seen', () => {
    expect(nextState(AI.WANDER, base())).toBe(AI.WANDER);
    expect(nextState(AI.WANDER, base({ canSee: true }))).toBe(AI.PURSUE);
  });

  it('keeps pursuing briefly after losing sight, then gives up', () => {
    expect(nextState(AI.PURSUE, base({ canSee: false, lostTime: 2 }))).toBe(AI.PURSUE);
    expect(nextState(AI.PURSUE, base({ canSee: false, lostTime: AI_TIMING.lostTimeout + 1 }))).toBe(AI.WANDER);
  });
});

describe('attacks', () => {
  it('winds up a grab when the player is in front and in reach', () => {
    expect(nextState(AI.PURSUE, base({ canSee: true, dist: 6 }))).toBe(AI.GRAB_WINDUP);
  });

  it('swipes instead when the player is close but not in front', () => {
    expect(nextState(AI.PURSUE, base({ canSee: true, dist: 6, inFront: false }))).toBe(AI.SWIPE_WINDUP);
  });

  it('closes in for a grab rather than swiping when a grab is available', () => {
    expect(nextState(AI.PURSUE, base({ canSee: true, dist: 9 }))).toBe(AI.PURSUE);
  });

  it('swipes when grab is on cooldown', () => {
    expect(nextState(AI.PURSUE, base({ canSee: true, dist: 6, grabReady: false }))).toBe(AI.SWIPE_WINDUP);
  });

  it('does not swipe at players below the swipe arc', () => {
    expect(nextState(AI.PURSUE, base({ canSee: true, dist: 6, inFront: false, swipeable: false }))).toBe(AI.PURSUE);
  });

  it('does not attack out of reach, while the player is held, or without arms', () => {
    expect(nextState(AI.PURSUE, base({ canSee: true, dist: 6, reachable: false }))).toBe(AI.PURSUE);
    expect(nextState(AI.PURSUE, base({ canSee: true, dist: 6, playerHeld: true }))).toBe(AI.PURSUE);
    expect(nextState(AI.PURSUE, base({ canSee: true, dist: 6, hasArm: false }))).toBe(AI.PURSUE);
  });

  it('telegraphs the grab for the full windup before grabbing', () => {
    expect(nextState(AI.GRAB_WINDUP, base({ t: AI_TIMING.grabWindup - 0.01 }))).toBe(AI.GRAB_WINDUP);
    expect(nextState(AI.GRAB_WINDUP, base({ t: AI_TIMING.grabWindup }))).toBe(AI.GRAB);
    expect(isWindup(AI.GRAB_WINDUP)).toBe(true);
    expect(isWindup(AI.GRAB)).toBe(false);
  });

  it('abnormal giants wind up faster', () => {
    const t = AI_TIMING.grabWindupAbnormal;
    expect(nextState(AI.GRAB_WINDUP, base({ t, abnormal: true }))).toBe(AI.GRAB);
    expect(nextState(AI.GRAB_WINDUP, base({ t, abnormal: false }))).toBe(AI.GRAB_WINDUP);
  });

  it('holds on a connected grab, recovers on a miss', () => {
    expect(nextState(AI.GRAB, base({ grabHit: true }))).toBe(AI.HOLD);
    expect(nextState(AI.GRAB, base({ t: AI_TIMING.grab }))).toBe(AI.RECOVER);
  });

  it('releases the player on escape or after the hold time', () => {
    expect(nextState(AI.HOLD, base({ t: 1 }))).toBe(AI.HOLD);
    expect(nextState(AI.HOLD, base({ t: 1, released: true }))).toBe(AI.RECOVER);
    expect(nextState(AI.HOLD, base({ t: AI_TIMING.holdMax }))).toBe(AI.RECOVER);
  });

  it('swipe windup leads to swipe then recovery', () => {
    expect(nextState(AI.SWIPE_WINDUP, base({ t: AI_TIMING.swipeWindup }))).toBe(AI.SWIPE);
    expect(nextState(AI.SWIPE, base({ t: AI_TIMING.swipe }))).toBe(AI.RECOVER);
    expect(nextState(AI.RECOVER, base({ t: AI_TIMING.recover, canSee: true }))).toBe(AI.PURSUE);
    expect(nextState(AI.RECOVER, base({ t: AI_TIMING.recover, canSee: false }))).toBe(AI.WANDER);
  });

  it('a windup is cancelled if the attacking arm is severed', () => {
    expect(nextState(AI.GRAB_WINDUP, base({ hasArm: false }))).toBe(AI.RECOVER);
    expect(nextState(AI.SWIPE_WINDUP, base({ hasArm: false }))).toBe(AI.RECOVER);
  });
});

describe('stagger', () => {
  it('interrupts windups and pursuit', () => {
    for (const s of [AI.PURSUE, AI.GRAB_WINDUP, AI.SWIPE_WINDUP, AI.WANDER, AI.SPRINT]) {
      expect(nextState(s, base({ staggered: true }))).toBe(AI.STAGGER);
    }
  });

  it('does not interrupt a hold', () => {
    expect(nextState(AI.HOLD, base({ staggered: true, t: 1 }))).toBe(AI.HOLD);
  });

  it('resumes the chase when the stagger ends', () => {
    expect(nextState(AI.STAGGER, base({ staggered: true }))).toBe(AI.STAGGER);
    expect(nextState(AI.STAGGER, base({ staggered: false, canSee: true }))).toBe(AI.PURSUE);
    expect(nextState(AI.STAGGER, base({ staggered: false, canSee: false, lostTime: 99 }))).toBe(AI.WANDER);
  });
});

describe('abnormal sprint', () => {
  it('abnormals can break into a sprint when far away', () => {
    expect(nextState(AI.PURSUE, base({ canSee: true, abnormal: true, dist: 60, roll: 0 }))).toBe(AI.SPRINT);
    expect(nextState(AI.PURSUE, base({ canSee: true, abnormal: false, dist: 60, roll: 0 }))).toBe(AI.PURSUE);
  });

  it('sprint ends in an attack or times out', () => {
    expect(nextState(AI.SPRINT, base({ canSee: true, dist: 6 }))).toBe(AI.GRAB_WINDUP);
    expect(nextState(AI.SPRINT, base({ canSee: true, t: AI_TIMING.sprintMax }))).toBe(AI.PURSUE);
  });
});

describe('grab escape', () => {
  it('bigger giants need more struggling', () => {
    expect(escapeRequired(15)).toBeGreaterThan(escapeRequired(4));
  });

  it('accumulates presses, decays over time, and escapes at the threshold', () => {
    let s = struggle(0, 3, 0, 10);
    expect(s.progress).toBe(3);
    s = struggle(s.progress, 0, 1, 10);
    expect(s.progress).toBeCloseTo(3 - GRAB_ESCAPE.decay);
    s = struggle(9.5, 1, 0, 10);
    expect(s.escaped).toBe(true);
    expect(struggle(0.5, 0, 5, 10).progress).toBe(0);
  });
});
