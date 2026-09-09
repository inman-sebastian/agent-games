// engine.js — pure puzzle logic: parse, simulate a move, win check, BFS solver.
// Runs identically in Node (verify.js/generate.js) and the browser (index.html)
// so the solver that grades levels and the game the player touches share ONE ruleset.
(function (root) {
  'use strict';

  const WALL = 0, ICE = 1, SAND = 2, PIT = 3;
  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

  // Map chars. Lowercase = on ice, uppercase variants = on sand.
  //   #=wall  .=ice  ==sand  x=pit  @=player  $=block  o=target
  //   A=player-on-sand  B=block-on-sand  T=target-on-sand
  function parse(mapStr) {
    const rows = mapStr.replace(/\n+$/, '').split('\n');
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const terrain = [], targets = [], blocks = [];
    let player = null;
    for (let r = 0; r < h; r++) {
      terrain.push(new Array(w).fill(WALL));
      for (let c = 0; c < w; c++) {
        const ch = rows[r][c] || '#';
        switch (ch) {
          case '#': terrain[r][c] = WALL; break;
          case '.': terrain[r][c] = ICE; break;
          case '=': terrain[r][c] = SAND; break;
          case 'x': terrain[r][c] = PIT; break;
          case '@': terrain[r][c] = ICE;  player = [r, c]; break;
          case 'A': terrain[r][c] = SAND; player = [r, c]; break;
          case '$': terrain[r][c] = ICE;  blocks.push([r, c]); break;
          case 'B': terrain[r][c] = SAND; blocks.push([r, c]); break;
          case 'o': terrain[r][c] = ICE;  targets.push([r, c]); break;
          case 'T': terrain[r][c] = SAND; targets.push([r, c]); break;
          default:  terrain[r][c] = WALL;
        }
      }
    }
    return { w, h, terrain, targets, player, blocks };
  }

  function terrainAt(level, r, c) {
    if (r < 0 || c < 0 || r >= level.h || c >= level.w) return WALL;
    return level.terrain[r][c];
  }

  function blockAt(blocks, r, c) {
    for (let i = 0; i < blocks.length; i++)
      if (blocks[i][0] === r && blocks[i][1] === c) return i;
    return -1;
  }

  function cellIn(list, r, c) {
    for (let i = 0; i < list.length; i++) if (list[i][0] === r && list[i][1] === c) return true;
    return false;
  }

  // Slide the player one direction. Everything slides on ice until it hits a
  // wall, another block, or lands on SAND (which halts the slide).
  //  - A PIT is lethal to the player: slide into an unfilled pit and you fall (dead).
  //  - A block shoved into an unfilled pit falls in, FILLS it (becomes floor),
  //    and is consumed — the push continues over the new ground.
  // Returns a new state {player, blocks, filled, dead, events} or null (no-op).
  // `events` lists the block that moved/fell this slide (for the renderer); BFS ignores it.
  function move(level, state, dir) {
    const [dr, dc] = DIRS[dir];
    let pr = state.player[0], pc = state.player[1];
    const blocks = state.blocks.map(b => [b[0], b[1]]);
    const filled = (state.filled || []).map(f => [f[0], f[1]]);
    const events = [];
    let moved = false, dead = false;
    while (true) {
      const nr = pr + dr, nc = pc + dc;
      const t = terrainAt(level, nr, nc);
      if (t === WALL) break;
      const bi = blockAt(blocks, nr, nc);
      if (bi >= 0) {
        const br = nr + dr, bc = nc + dc;
        const bt = terrainAt(level, br, bc);
        if (bt === WALL || blockAt(blocks, br, bc) >= 0) break; // block wedged; player stops
        if (bt === PIT && !cellIn(filled, br, bc)) {            // block falls in and fills the pit
          events.push({ from: [nr, nc], to: [br, bc], consumed: true });
          filled.push([br, bc]);
          blocks.splice(bi, 1);
          pr = nr; pc = nc; moved = true;
          if (terrainAt(level, pr, pc) === SAND) break;
          continue;
        }
        blocks[bi] = [br, bc];                                  // ordinary shove
        events.push({ from: [nr, nc], to: [br, bc], consumed: false });
        pr = nr; pc = nc; moved = true;
        if (bt === SAND) break;                                 // block bit into sand — push ends
        if (terrainAt(level, pr, pc) === SAND) break;
        continue;
      }
      if (t === PIT && !cellIn(filled, nr, nc)) {               // player slides into a pit → falls
        pr = nr; pc = nc; moved = true; dead = true; break;
      }
      pr = nr; pc = nc; moved = true;
      if (t === SAND) break;                                    // ice / filled-pit → keep sliding
    }
    return moved ? { player: [pr, pc], blocks, filled, dead, events } : null;
  }

  function isWin(level, state) {
    return level.targets.every(t => blockAt(state.blocks, t[0], t[1]) >= 0);
  }

  function keyOf(state, w) {
    const p = state.player[0] * w + state.player[1];
    const bs = state.blocks.map(b => b[0] * w + b[1]).sort((a, b) => a - b);
    const fs = (state.filled || []).map(f => f[0] * w + f[1]).sort((a, b) => a - b);
    return p + '|' + bs.join(',') + '|' + fs.join(',');
  }

  // Breadth-first search over game states → shortest solution (the level's
  // "par"). Dead states (player fell) are never expanded, so any solution the
  // solver returns is death-free by construction.
  function solve(level, maxNodes = 400000) {
    const start = { player: level.player.slice(), blocks: level.blocks.map(b => b.slice()), filled: [] };
    if (isWin(level, start)) return { moves: [], length: 0, nodes: 0 };
    const seen = new Set([keyOf(start, level.w)]);
    let frontier = [{ state: start, path: [] }];
    let nodes = 0;
    while (frontier.length) {
      const next = [];
      for (const node of frontier) {
        for (const dir in DIRS) {
          const ns = move(level, node.state, dir);
          if (!ns || ns.dead) continue;
          const k = keyOf(ns, level.w);
          if (seen.has(k)) continue;
          seen.add(k);
          nodes++;
          const path = node.path.concat(dir);
          if (isWin(level, ns)) return { moves: path, length: path.length, nodes };
          if (nodes > maxNodes) return { moves: null, length: Infinity, nodes, aborted: true };
          next.push({ state: ns, path });
        }
      }
      frontier = next;
    }
    return { moves: null, length: Infinity, nodes };
  }

  const Engine = { WALL, ICE, SAND, PIT, DIRS, parse, move, isWin, solve, terrainAt, blockAt, cellIn, keyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof self !== 'undefined' ? self : this);
