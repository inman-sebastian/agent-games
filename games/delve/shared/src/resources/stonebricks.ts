// Stone Bricks — ore resource (self-registers into the registry).
// EXPERIMENTAL: a structured, constructed material (brick courses + mortar) to stress-test the
// material contract — see client/src/render/materials/stonebricks.ts. Registered as an ore for now
// so it flows through the whole pipeline (world-gen + swatch + in-world) and is viewable; a built
// material like this really belongs in ruins/structures, not random veins — revisit placement later.
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 13,
  name: 'Stone Bricks',
  band: [20, 90],
  weight: 2,
  value: 4,
  hp: 5,
  color: '#8a94a0',
  desc: 'Cut and laid by some earlier hand. What were they building down here?',
  art: { shape: 'nugget', c: ['#3e3546', '#6f708a', '#9babb2'] },
} satisfies OreResource);
