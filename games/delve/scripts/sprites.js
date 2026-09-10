// sprites.js — authored character/entity sprites, shared by the game (index.html) and
// the style lab so they stay identical. Pure drawing over any 2D context. Attaches
// DelveSprites to `self`, matching the other modules' pattern.
(function (root) {
  'use strict';

  // The miner: dark cool outline, orange helmet + lamp, visor, blue overalls, boots,
  // pickaxe over the shoulder. `bob` is a vertical offset for the idle/walk bob.
  function drawMiner(g, X, Y, facing, bob) {
    bob = bob || 0;
    const O = '#0a0912', H = '#e6904e', HD = '#cd683d', VIS = '#25222c', GLINT = '#8fd3ff', LAMP = '#fbff86',
          F = '#e6b98e', FD = '#c7955f', B = '#4d65b4', BD = '#323353', BL = '#4d9be6', BOOT = '#4c3e24', PK = '#9babb2', PKH = '#7a5030';
    const P = (a, b, w, h, col) => { g.fillStyle = col; g.fillRect(X + a, Y + b + bob, (w || 1), (h || 1)); };
    P(9, 3, 1, 4, PKH); P(8, 2, 4, 1, PK); P(11, 3, 1, 1, PK); P(8, 3, 1, 1, PK);
    for (const [a, b, w, h] of [[4, 1, 5, 1], [3, 2, 7, 1], [3, 3, 1, 6], [9, 3, 1, 6], [3, 9, 7, 1], [3, 9, 1, 4], [8, 9, 1, 4], [4, 13, 5, 1]]) P(a, b, w, h, O);
    P(4, 2, 5, 1, H); P(4, 3, 5, 1, H); P(4, 4, 5, 1, HD);
    const lx = facing === 'left' ? 3 : facing === 'right' ? 8 : 6; P(lx, 1, 2, 1, LAMP); P(lx, 2, 1, 1, '#f9c22b');
    P(4, 5, 5, 2, F); P(4, 7, 5, 1, FD); P(4, 5, 5, 1, VIS); P(7, 5, 1, 1, GLINT);
    P(4, 7, 5, 2, B); P(4, 8, 5, 1, BD); P(6, 7, 1, 2, BL);
    P(4, 9, 2, 3, B); P(7, 9, 2, 3, B); P(4, 12, 2, 1, BOOT); P(7, 12, 2, 1, BOOT);
  }

  root.DelveSprites = { drawMiner };
})(self);
