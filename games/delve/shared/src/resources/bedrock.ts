// Bedrock — strata resource (self-registers into the registry). The floor (#57): the one tile
// nothing breaks. `hard` so the basalt above does not slowly darken into it — see PALETTE.md.
import { register } from '../registry';
import type { StrataResource } from '../types';

register({
  type: 'strata',
  id: 'bedrock', // near-black
  top: 700, // must equal FLOOR in blocks.ts (which imports this file, so it can't import back) — tested
  hard: true,
  ramp: ['#2e222f', '#2e222f', '#313638', '#3e3546', '#374e4a', '#625565'],
} satisfies StrataResource);
