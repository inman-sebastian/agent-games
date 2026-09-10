// Gold — ore resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'ore', id: 5, name: 'Gold',
    band: [76, 156], weight: 11, value: 95, hp: 4, color: '#f5c84e',
    desc: "Heavy, radiant, and reliably valuable.",
    art: { shape: 'nugget', c: ['#4c3e24', '#f9c22b', '#fbff86'] },
  });
})();
