// Mythril — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 9,
  name: 'Mythril',
  band: [480, 99999],
  weight: 2,
  hp: 15,
  // the top tier, held alone — nothing else in the game should ever feel this good to break
  rarity: 6,
  color: '#bd77f5',
  desc: 'The legendary violet ore of the abyss.',
  art: { shape: 'shard', c: ['#484a77', '#905ea9', '#a884f3'] },
} satisfies OreResource);
