// Diamond — ore resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'ore', id: 8, name: 'Diamond',
    band: [330, 530], weight: 3, value: 2100, hp: 11, color: '#66e0ee',
    desc: "Flawless and adamant. Few dig deep enough to find it.",
    art: { shape: 'gem', c: ['#0b8a8f', '#30e1b9', '#8ff8e2'] },
  });
})();
