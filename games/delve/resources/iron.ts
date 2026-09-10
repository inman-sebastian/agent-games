// Iron — ore resource (self-registers into the registry).
import { register } from '../scripts/resources';
import type { OreResource } from '../scripts/types';

register({
  type: 'ore',
  id: 3,
  name: 'Iron',
  band: [16, 52],
  weight: 22,
  value: 12,
  hp: 2,
  color: '#c2ccd8',
  desc: "Tough, dependable ore of the upper stone.",
  art: { shape: 'nugget', c: ["#3e3546", "#7f708a", "#c7dcd0"] },
} satisfies OreResource);
