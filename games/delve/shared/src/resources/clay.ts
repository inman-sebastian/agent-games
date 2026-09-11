// Clay — strata resource (self-registers into the registry).
import { register } from '../registry';
import type { StrataResource } from '../types';

register({
  type: 'strata',
  id: 'clay', // warm ochre/tan
  top: 24,
  ramp: ['#2a2018', '#48371f', '#6d5230', '#8f6b3c', '#b28a4e', '#d0aa66'],
} satisfies StrataResource);
