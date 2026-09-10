// Stone — strata resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'strata', id: 'stone', top: 84,   // cool gray
    ramp: ['#2e222f', '#3e3546', '#625565', '#7f708a', '#9babb2', '#c7dcd0'],
  });
})();
