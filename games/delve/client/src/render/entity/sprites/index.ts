// index.ts — every imported player animation, in one registry.
//
// Hand-written rather than generated, so the set of animations the game knows about is a reviewable
// list. `tools/sprites.test.ts` fails if a module in this directory is missing here, which is the
// part worth automating.
import { PLAYER_AIR_SPIN } from './player-air-spin';
import { PLAYER_CROUCH_IDLE } from './player-crouch-idle';
import { PLAYER_CROUCH_WALK } from './player-crouch-walk';
import { PLAYER_DEATH } from './player-death';
import { PLAYER_HURT } from './player-hurt';
import { PLAYER_IDLE } from './player-idle';
import { PLAYER_JUMP } from './player-jump';
import { PLAYER_LAND } from './player-land';
import { PLAYER_LEDGE_CLIMB } from './player-ledge-climb';
import { PLAYER_PULL } from './player-pull';
import { PLAYER_PUSH } from './player-push';
import { PLAYER_PUSH_IDLE } from './player-push-idle';
import { PLAYER_ROLL } from './player-roll';
import { PLAYER_RUN } from './player-run';
import { PLAYER_WALK } from './player-walk';

export const PLAYER_SPRITES = {
  air_spin: PLAYER_AIR_SPIN,
  crouch_idle: PLAYER_CROUCH_IDLE,
  crouch_walk: PLAYER_CROUCH_WALK,
  death: PLAYER_DEATH,
  hurt: PLAYER_HURT,
  idle: PLAYER_IDLE,
  jump: PLAYER_JUMP,
  land: PLAYER_LAND,
  ledge_climb: PLAYER_LEDGE_CLIMB,
  pull: PLAYER_PULL,
  push: PLAYER_PUSH,
  push_idle: PLAYER_PUSH_IDLE,
  roll: PLAYER_ROLL,
  run: PLAYER_RUN,
  walk: PLAYER_WALK,
} as const;

export type PlayerAnim = keyof typeof PLAYER_SPRITES;

/**
 * The layer slots a player animation may use, in paint order.
 *
 * Names are normalised at import time (see tools/import-aseprite.ts) precisely so an equipment
 * override written once applies to every animation — the pack itself calls the same part "Back Arm",
 * "Back Hand" and "Left Arm" in different files.
 */
export const PLAYER_SLOTS = [
  'arm.far',
  'leg.far',
  'torso',
  'leg.near',
  'arm.near',
  'head',
  'weapon',
  'fx.damage',
] as const;

export type PlayerSlot = (typeof PLAYER_SLOTS)[number];
