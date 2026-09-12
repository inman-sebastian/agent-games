// Platinum — ore resource (self-registers into the registry).
import { register } from '../registry';
import type { OreResource } from '../types';

register({
  type: 'ore',
  id: 10,
  name: 'Platinum',
  band: [210, 360],
  weight: 4,
  hp: 7,
  color: '#dfe6ef',
  desc: 'A rare, lustrous white metal — worth more than gold to those who reach it.',
  art: { shape: 'nugget', c: ['#5f6b7e', '#bcc9d6', '#f0f6ff'] },
} satisfies OreResource);
