// Copper — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 2,
  name: 'Copper',
  band: [4, 24],
  weight: 26,
  value: 5,
  hp: 1,
  color: '#d67b40',
  desc: 'Ruddy starter metal, common in the shallows.',
  art: { shape: 'nugget', c: ['#7a3045', '#cd683d', '#f79617'] },
} satisfies OreResource);
