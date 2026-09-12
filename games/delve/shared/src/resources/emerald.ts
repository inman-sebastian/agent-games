// Emerald — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 6,
  name: 'Emerald',
  band: [132, 240],
  weight: 7,
  hp: 6,
  // the entry gem; weight 7 makes it the common one of its class
  rarity: 3,
  color: '#41cf76',
  desc: 'The first true gem — deep green, deeply prized.',
  art: { shape: 'prism', c: ['#165a4c', '#1ebc73', '#91db69'] },
} satisfies OreResource);
