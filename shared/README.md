# shared

Cross-game modules — helpers, utilities, and algorithms used by more than one
game (easing, RNG, particle emitters, input buffering, save/load, audio, geometry, …).

Empty by design. Following the "extract on the second real use" rule in the root
`CLAUDE.md`, code graduates here only once a second game genuinely needs it —
don't add speculative modules.

When the first shared module lands, give it its own `package.json` (name it e.g.
`@shared/<module>`); the pnpm workspace already globs `shared/*`, so it becomes
importable by any game automatically.
