// Iron — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 3,
  name: 'Iron',
  band: [16, 52],
  weight: 22,
  value: 12,
  hp: 2,
  color: '#c2ccd8',
  desc: 'Tough, dependable ore of the upper stone.',
  art: { shape: 'nugget', c: ['#3e3546', '#7f708a', '#c7dcd0'] },
} satisfies OreResource);
