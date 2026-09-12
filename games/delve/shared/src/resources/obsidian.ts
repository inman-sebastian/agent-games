// Obsidian — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 11,
  name: 'Obsidian',
  band: [430, 650],
  weight: 6,
  value: 160,
  hp: 12,
  color: '#2a2540',
  desc: 'Volcanic glass from the deep dark — jet black, glassy, and stubbornly hard.',
  art: { shape: 'shard', c: ['#17151f', '#33304a', '#8a86b0'] },
} satisfies OreResource);
