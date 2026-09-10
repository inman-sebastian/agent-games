// Emerald — ore resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'ore', id: 6, name: 'Emerald',
    band: [132, 240], weight: 7, value: 260, hp: 6, color: '#41cf76',
    desc: "The first true gem — deep green, deeply prized.",
    art: { shape: 'prism', c: ['#165a4c', '#1ebc73', '#91db69'] },
  });
})();
