// Clay — strata resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'strata', id: 'clay', top: 24,   // warm ochre/tan
    ramp: ['#2a2018', '#48371f', '#6d5230', '#8f6b3c', '#b28a4e', '#d0aa66'],
  });
})();
