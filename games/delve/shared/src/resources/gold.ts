// Gold — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 5,
  name: 'Gold',
  band: [76, 156],
  weight: 11,
  value: 95,
  hp: 4,
  color: '#f5c84e',
  desc: 'Heavy, radiant, and reliably valuable.',
  art: { shape: 'nugget', c: ['#4c3e24', '#f9c22b', '#fbff86'] },
} satisfies OreResource);
