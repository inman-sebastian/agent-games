// Quartz — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 12,
  name: 'Quartz',
  band: [95, 210],
  weight: 11,
  value: 48,
  hp: 3,
  color: '#e8e6ee',
  desc: 'Milky crystal clusters that catch the light — common, but pretty.',
  art: { shape: 'prism', c: ['#6f6d78', '#c9c7d0', '#ffffff'] },
} satisfies OreResource);
