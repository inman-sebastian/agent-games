// Dirt — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 1,
  name: 'Dirt',
  band: [2, 8],
  weight: 60,
  value: 1,
  hp: 0,
  color: '#a06a3c',
  dim: true,
  desc: 'Loose surface clod. Worth almost nothing, but it counts.',
  art: { shape: 'nugget', c: ['#48371f', '#6d5230', '#8f6b3c'], dim: true },
} satisfies OreResource);
