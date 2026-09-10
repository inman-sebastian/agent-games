// Deepstone — strata resource (self-registers into the registry).
import { register } from '../scripts/resources';
import type { StrataResource } from '../scripts/types';

register({
  type: 'strata',
  id: 'deepstone', // blue
  top: 190,
  ramp: ["#2e222f", "#323353", "#484a77", "#4d65b4", "#4d9be6", "#8fd3ff"],
} satisfies StrataResource);
