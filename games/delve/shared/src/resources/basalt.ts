// Basalt — strata resource (self-registers into the registry).
import { register } from '../registry';
import type { StrataResource } from '../types';

register({
  type: 'strata',
  id: 'basalt', // violet
  top: 370,
  ramp: ['#2e222f', '#45293f', '#6b3e75', '#905ea9', '#a884f3', '#eaaded'],
} satisfies StrataResource);
