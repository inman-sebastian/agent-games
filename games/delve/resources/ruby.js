// Ruby — ore resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'ore', id: 7, name: 'Ruby',
    band: [216, 370], weight: 5, value: 720, hp: 8, color: '#ee4f66',
    desc: "A cluster of crimson fire from the deep stone.",
    art: { shape: 'cluster', c: ['#831c5d', '#f04f78', '#f68181'] },
  });
})();
