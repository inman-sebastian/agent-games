// Deepstone — strata resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'strata', id: 'deepstone', top: 190,   // blue
    ramp: ['#2e222f', '#323353', '#484a77', '#4d65b4', '#4d9be6', '#8fd3ff'],
  });
})();
