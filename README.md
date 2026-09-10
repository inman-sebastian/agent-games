# agent-game

A pnpm-workspace monorepo of small **browser games** built agentically — each
runs on the open web platform (HTML/CSS/JS, Canvas), no other target.

- **`games/*`** — each game in its own package (source, docs, deployment config).
- **`shared/*`** — cross-game modules, imported by any game (see `shared/README.md`).
- **root** — workspace config plus `CLAUDE.md`, the shared design guide (game
  feel, juice, sound, input, art direction, workflow) that applies to every game.

Anything specific to one game belongs in that game's package, not the root.

## Games

- [DELVE](games/delve/)
- [DRIFT](games/drift/)

## Working in the monorepo

```sh
pnpm install            # link the workspace
pnpm -r --if-present verify   # run every game's checks (or `pnpm verify`)
pnpm --filter drift verify    # run one game's checks
```
