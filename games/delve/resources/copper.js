// Copper — ore resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'ore', id: 2, name: 'Copper',
    band: [4, 24], weight: 26, value: 5, hp: 1, color: '#d67b40',
    desc: "Ruddy starter metal, common in the shallows.",
    art: { shape: 'nugget', c: ['#7a3045', '#cd683d', '#f79617'] },
  });
})();
