// Silver — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 4,
  name: 'Silver',
  band: [40, 92],
  weight: 15,
  hp: 3,
  // the first genuinely precious metal, and shallow enough to be an early reward
  rarity: 2,
  color: '#f0f4fa',
  desc: 'Bright and soft, glinting in cool grey rock.',
  art: { shape: 'nugget', c: ['#625565', '#9babb2', '#e8eef5'] },
} satisfies OreResource);
