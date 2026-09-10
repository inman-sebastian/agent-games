// Silver — ore resource. Self-registers into the DelveResources registry
// (works in the browser, the chunk Worker, and Node with no build step).
(function () {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('../scripts/resources') : self.DelveResources;
  R.register({
    type: 'ore', id: 4, name: 'Silver',
    band: [40, 92], weight: 15, value: 34, hp: 3, color: '#f0f4fa',
    desc: "Bright and soft, glinting in cool grey rock.",
    art: { shape: 'nugget', c: ['#625565', '#9babb2', '#e8eef5'] },
  });
})();
