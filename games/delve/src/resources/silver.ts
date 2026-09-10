// Silver — ore resource (self-registers into the registry).
import { register } from '../scripts/resources';
import type { OreResource } from '../scripts/types';

register({
  type: 'ore',
  id: 4,
  name: 'Silver',
  band: [40, 92],
  weight: 15,
  value: 34,
  hp: 3,
  color: '#f0f4fa',
  desc: "Bright and soft, glinting in cool grey rock.",
  art: { shape: 'nugget', c: ["#625565", "#9babb2", "#e8eef5"] },
} satisfies OreResource);
