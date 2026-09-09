# DELVE

A pixel-art incremental mining game. Tunnel down through deepening rock, fill
your cargo with ore, haul it back to the surface to sell, and reinvest in a
sharper pickaxe, bigger cargo, quicker hands, and technology — then dig deeper,
where the rock is tougher and the ore is rarer. Copper → Iron → Silver → Gold →
Emerald → Ruby → Diamond → Mythril.

Open `index.html` in a browser. Progress auto-saves to `localStorage`.

- **Move & dig:** WASD / arrow keys, or hold the mouse toward a wall. On touch,
  drag toward a wall.
- **Sell:** return to the surface with ore in your cargo — it sells automatically.
- **Spend:** the **⛏ Upgrades** panel. Buy upgrades and one-time tech (Ore
  Scanner, Deep Lantern).

## Design

- `engine.js` — the pure sim: an infinite, deterministic world (every tile is a
  pure function of `seed, col, row`, so a save stores only what you've dug),
  dig/move resolution, economy, and upgrades. No presentation, no DOM.
- `index.html` — canvas renderer (low-res logical buffer scaled with
  `image-rendering: pixelated`), lighting, particles, screen shake, synthesized
  Web Audio, input, and the HTML shop chrome. Imports `engine.js` unchanged.
- `verify.js` — the balance gate. Digging is free, so a hard soft-lock is
  impossible; the risk is *pacing*. It drives a greedy bot through the **same
  engine** the player uses and asserts it reaches every ore tier down into
  Mythril within a sane action budget, plus static invariants on the ore table,
  cost curves, and world generation. Run `pnpm verify` (or `node verify.js`).

See `STYLE.md` for the art direction (palette, sprite grid, lighting, juice).

## Why no gravity / no fuel

Both are classic soft-lock generators (dig down, can't get back). DELVE's
traversal comes from your own persistent tunnels instead — you can always climb
back the way you came — so the economy is provably progress-only and the balance
gate can prove it.
