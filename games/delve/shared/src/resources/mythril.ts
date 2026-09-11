// Mythril — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 9,
  name: 'Mythril',
  band: [480, 99999],
  weight: 2,
  value: 6200,
  hp: 15,
  color: '#bd77f5',
  desc: 'The legendary violet ore of the abyss.',
  art: { shape: 'shard', c: ['#484a77', '#905ea9', '#a884f3'] },
} satisfies OreResource);
