// index.ts — pull in every material so it self-registers (mirrors resources/index.ts). Importing
// this once wires the material registry; add a line per new material.
import './gold';
import './iron';
import './emerald';

export { oreMaterial, registerOreMaterial } from './types';
export type { Material, ShadeCtx } from './types';
export { collectTwinkleEdges } from './fx';
export type { TwinkleEdge } from './fx';
