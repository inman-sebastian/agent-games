// Topsoil — strata resource (self-registers into the registry).
import { register } from '../scripts/resources';
import type { StrataResource } from '../scripts/types';

register({
  type: 'strata',
  id: 'topsoil', // red-brown
  top: 2,
  ramp: ["#2e222f", "#45293f", "#7a3045", "#9e4539", "#cd683d", "#e6904e"],
} satisfies StrataResource);
