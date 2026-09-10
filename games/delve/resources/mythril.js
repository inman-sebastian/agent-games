// Mythril — ore resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'ore', id: 9, name: 'Mythril',
    band: [480, 99999], weight: 2, value: 6200, hp: 15, color: '#bd77f5',
    desc: "The legendary violet ore of the abyss.",
    art: { shape: 'shard', c: ['#484a77', '#905ea9', '#a884f3'] },
  });
})();
