// Ruby — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 7,
  name: 'Ruby',
  band: [216, 370],
  weight: 5,
  hp: 8,
  color: '#ee4f66',
  desc: 'A cluster of crimson fire from the deep stone.',
  art: { shape: 'cluster', c: ['#831c5d', '#f04f78', '#f68181'] },
} satisfies OreResource);
