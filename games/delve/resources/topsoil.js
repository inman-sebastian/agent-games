// Topsoil — strata resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'strata', id: 'topsoil', top: 2,   // red-brown
    ramp: ['#2e222f', '#45293f', '#7a3045', '#9e4539', '#cd683d', '#e6904e'],
  });
})();
