// Diamond — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 8,
  name: 'Diamond',
  band: [330, 530],
  weight: 3,
  hp: 11,
  // scarce (weight 3) and the hardest thing above mythril
  rarity: 5,
  color: '#66e0ee',
  desc: 'Flawless and adamant. Few dig deep enough to find it.',
  art: { shape: 'gem', c: ['#0b8a8f', '#30e1b9', '#8ff8e2'] },
} satisfies OreResource);
