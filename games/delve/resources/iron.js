// Iron — ore resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'ore', id: 3, name: 'Iron',
    band: [16, 52], weight: 22, value: 12, hp: 2, color: '#c2ccd8',
    desc: "Tough, dependable ore of the upper stone.",
    art: { shape: 'nugget', c: ['#3e3546', '#7f708a', '#c7dcd0'] },
  });
})();
