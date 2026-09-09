# DRIFT

A minimalist ice-sliding puzzle game. Everything slides until it hits a wall or
another block; only **sand** stops a slide. Push every block onto a gold ring.

Later levels add **pits**: slide into one and you fall (the level retries), but a
block shoved into a pit fills it into solid floor — so pits are both a hazard and
a resource. Don't waste a block you need for a target.

Built entirely by an AI with no human input — so instead of a playtester, a BFS
**solver is the quality gate**: no level ships unless it's provably solvable
(death-free), each level's "par" is its shortest solution, and pit levels are
chosen so filling is genuinely required.

## Play

Open `index.html` in a browser (double-click it, or `python3 -m http.server` and
visit the page).

- **Desktop:** arrow keys / WASD to move · **Z** undo · **R** restart · **H** hint · **[** / **]** prev/next · **space** next level after a win.
- **Mobile:** swipe to move, tap to advance after a win. The board scales to the screen, key hints are hidden, and the Vibration API adds haptics for bumps, pit-fills, falls and wins (the ♪ button also toggles haptics off).

## Files

- `engine.js` — the ruleset: parse, one-move slide simulation (walls, sand, pits, fills, death), win check, BFS solver. Shared by the game and the tools so they can never disagree.
- `levels.js` — the shipped levels (generated, each proven solvable).
- `generate.js` — seeded generator: sprinkles maps incl. pits, keeps only solver-approved ones, prefers levels where filling is required, writes `levels.js`. Run `node generate.js`.
- `verify.js` — the runnable check: re-solves every shipped level and asserts par is correct, solutions are death-free, and the pit mechanic is exercised. Run `node verify.js`.
