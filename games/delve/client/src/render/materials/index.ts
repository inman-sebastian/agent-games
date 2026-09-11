// index.ts — pull in every material so it self-registers (mirrors resources/index.ts). Importing
// this once wires the material registry; add a line per new material.
import './copper';
import './iron';
import './silver';
import './gold';
import './emerald';
import './ruby';
import './diamond';
import './mythril';

export { oreMaterial, registerOreMaterial } from './types';
export type { Material, ShadeCtx } from './types';
export { collectTwinkleEdges } from './fx';
export type { TwinkleEdge } from './fx';
