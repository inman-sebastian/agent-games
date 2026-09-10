// manifest.js — the list of entity resource files, for the browser's synchronous loader
// (index.html / style-lab.html / tools/render.html each document.write these in order).
// Node doesn't use this — scripts/resources.js auto-discovers the directory via fs — and
// verify.js asserts this list matches the directory, so the two can't drift.
(function (root) {
  'use strict';
  const FILES = [
    // strata (shallow → deep)
    'topsoil', 'clay', 'stone', 'deepstone', 'basalt',
    // ores (by id)
    'dirt', 'copper', 'iron', 'silver', 'gold', 'emerald', 'ruby', 'diamond', 'mythril',
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = FILES;
  else root.DELVE_RESOURCE_FILES = FILES;
})(typeof self !== 'undefined' ? self : this);
