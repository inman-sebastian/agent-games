// Stone — strata resource (self-registers into the registry).
import { register } from '../registry';
import type { StrataResource } from '../types';

register({
  type: 'strata',
  id: 'stone', // cool gray
  top: 84,
  ramp: ['#2e222f', '#3e3546', '#625565', '#7f708a', '#9babb2', '#c7dcd0'],
} satisfies StrataResource);
