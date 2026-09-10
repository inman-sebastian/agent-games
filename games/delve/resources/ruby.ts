// Ruby — ore resource (self-registers into the registry).
import { register } from '../scripts/resources';
import type { OreResource } from '../scripts/types';

register({
  type: 'ore',
  id: 7,
  name: 'Ruby',
  band: [216, 370],
  weight: 5,
  value: 720,
  hp: 8,
  color: '#ee4f66',
  desc: "A cluster of crimson fire from the deep stone.",
  art: { shape: 'cluster', c: ["#831c5d", "#f04f78", "#f68181"] },
} satisfies OreResource);
