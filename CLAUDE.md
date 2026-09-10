# Building games in this workspace

Shared design lessons for every game here. **Every game in this workspace is a
browser game** — it runs on the open web platform (HTML, CSS, JavaScript,
Canvas/WebGL/WebGPU, Web Audio, and the rest) and nowhere else. There is no other
target, engine, native runtime, or console; assume the browser in every decision.
This is a pnpm-workspace monorepo: games live in `games/*`, cross-game code in
`shared/*`. Game-specific rules, tuning values, and stack choices live in each
game's own package under `games/`; this file is only the stuff that carries
across all of them, regardless of genre. DRIFT (`games/drift/`) is cited
occasionally as an example, not as a rule.

The through-line: **a game is correct logic wrapped in feedback.** The rules
themselves are usually small; almost all the work — and almost all the "feel" —
is in how the player *perceives* those rules happening. Budget time accordingly.

Everything below is a direction to tune, not a fixed number. Feel is found by
playing and adjusting; treat any specific value you see as a starting point.

---

## What you're building (non-negotiables)

Read this before writing any code — it overrides convenient assumptions.

- **A real, playable game a human sits down and plays** — not a headless
  simulation, not a script that prints the outcome. There is always a human
  player. The deliverable is something you launch and *play*, with a visible
  presentation layer, real controls, and feedback, from the very first version.
- **"Separate simulation from presentation" never means skip the presentation.**
  It means the two are cleanly separated — the sim is pure and testable, the
  presentation renders it. Both always ship. A game with no rendering layer is
  unfinished, not minimal.
- **Create every asset yourself.** All art, sprites, backgrounds, icons, and
  effects are authored by the agent — drawn in code (canvas/SVG/shapes),
  generated, or synthesized. **Never use emoji, clip art, or found/placeholder
  images as game assets.** Emoji are not art. If a real asset isn't ready yet,
  draw a deliberate primitive (a shaded shape) as a stand-in, not a glyph.
- **The game always renders to a `<canvas>`** (2D, WebGL, or WebGPU) — the game
  field is drawn, not assembled from DOM elements or text characters. HTML/CSS is
  for surrounding chrome (menus, HUD, buttons), not the play area.

## Game feel

- **Separate simulation from presentation.** Resolve what happened in logic
  (ideally a testable, pure step), then *animate toward* that already-decided
  result. The sim never lies and can be verified; the animation is garnish that
  can be interrupted, skipped, or restyled without touching the rules.
- **Nothing important teleports.** State changes get a transition. A thing that
  jumps between states reads as a bug; the same thing moving between them reads
  as physics. Scale transition time with magnitude so a big change feels bigger
  than a small one.
- **Impacts need a reaction.** When something stops, lands, or gets hit, it
  should visibly respond — deform, recoil, flash. A brief squash/stretch or
  knockback sells an impact more than the collision itself. Keep it short and
  always return to rest.
- **Anticipation and follow-through beat instant, linear motion.** Stagger cause
  and effect rather than firing everything on the same frame, and let secondary
  effects (dust, trails, ripples) outlive the action that spawned them so the eye
  has something to follow.
- **Give weight to consequential moments.** A brief pause or hold on a big event
  makes it land as something that *mattered*. Don't let the important beat and a
  trivial one read at the same speed.

## Juice (cheap polish that makes it feel expensive)

Juice is secondary feedback layered on primary actions — the same rules feel
completely different with and without it. High-ROI layers, most games can afford
all of them:

1. **Screen shake** — small, decaying, and directional when there's a cause. Keep
   it subtle; large shake reads as broken.
2. **Particles** — one reusable emitter parameterized by color/count/speed/
   lifetime/gravity covers dust, sparkles, debris, and more. Build it once, reuse
   it everywhere.
3. **Motion trails / smears** on fast movement make speed legible.
4. **Idle life** — nothing on screen should be perfectly still. Gentle pulses,
   bobs, or breathing on interactive elements keep the scene alive and draw the
   eye to what matters.
5. **Celebrate success disproportionately.** Stack effects on the reward moment —
   it's where players decide whether to keep going. Overspend here.
6. **Let the celebration play before UI covers it.** Don't slam a modal over the
   payoff the instant it triggers.

Rule of thumb: juice attaches to *state transitions* (start, impact, success,
failure), not to steady state. Enumerate every transition and ask "what does the
player see, hear, and feel here?"

## Sound design

- **Synthesize audio with the Web Audio API.** Oscillators, noise buffers, and
  filters cover an entire game's SFX with zero load time, no binary assets, and
  instant iteration. Fall back to sampled audio only when you need richness
  synthesis can't reach.
- **Map timbre to meaning.** Rising pitch reads as good, falling as bad; short
  and bright for small events, low and bodied for heavy ones, noise for
  friction/whooshes. Consistency matters more than realism.
- **Fire sound with the visual, not the input** — at the moment of contact/impact
  in the animation, not the button press that caused it.
- **Unlock audio on the first user gesture.** Browsers keep the `AudioContext`
  suspended until an input, so create/resume it on the first key or tap, not at
  load. Route everything through a single mute switch so muting is instant and
  total.

## Input handling

- **One input = one action, unless the design says otherwise.** Don't let a held
  or mashed control chain actions or let the animation desync from the sim. For
  discrete/turn-based feel, lock input until the action has fully *settled*, not
  just visually arrived.
- **Buffer input instead of dropping it.** If a control can't act yet, remember
  the most recent intent and apply it the instant the game is ready. This is much
  of the gap between "responsive" and "sticky."
- **Support every relevant input scheme from the start** and detect the device to
  adapt the UI — keyboard *and* gamepad, mouse *and* touch, on-screen hints only
  where the keys exist. Enlarge targets and swap prompts for touch.
- **Claim the inputs you use** so the platform doesn't (prevent page scroll/zoom
  on game keys and gestures, capture the pointer where needed).
- **Add every feedback channel the device offers** — haptics/rumble are the
  tactile twin of screen shake and cost almost nothing. Fold them under the same
  off-switch as audio.

## Readability & accessibility

- **Never rely on color alone, or on low-contrast cues.** Back color with shape,
  motion, and contrast so state reads on any display and for colorblind players.
  Motion is the most reliable "look here" signal — pulse or animate the thing
  that needs attention.
- **State should be legible without reading text.** Interactive, active, hazard,
  and completed things should each look distinct at a glance; text HUD is a
  backup, not the primary channel.
- **Reduce the fear of experimenting.** Undo, restart, checkpoints, and honest
  hints let players explore. Any hint or assist should reflect the *actual* game
  state, never suggest something impossible.

## Progression & persistence

- **Persist progress and settings, and degrade gracefully** if storage is
  missing or corrupt — always have a sane default.
- **Give a reason to replay** (personal bests against a target, ratings, times).
- **Gate advancement lightly** — open the next challenge on success, but let
  players revisit anything already cleared.

## Content quality gates

- **Automate content verification wherever the domain allows.** DRIFT's biggest
  structural win was a solver that proved every level was solvable, computed its
  true difficulty, and confirmed the intended mechanic was actually required — so
  no broken content could ship without a human playtesting each one. Any game
  with checkable properties (solvable puzzles, reachable objectives, balanced
  economies, no soft-locks) can encode those as automated checks and run them
  before shipping content. Where the win condition isn't decidable, at least
  assert invariants the simulation must never violate.
- **One shared ruleset, imported by everything.** The renderer, the tools, and
  the tests must all call the *same* logic. The moment gameplay rules are
  duplicated in the presentation layer, the tests stop testing the real game and
  the two drift apart.

## Art direction

- **You author every asset — no emoji, no clip art, no stock images.** All art is
  created by the agent (drawn in code, generated, or synthesized) to fit the
  game's style guide. A glyph or found image dropped in as a game object is never
  acceptable, even as a placeholder — use a deliberate primitive shape instead.
- **Codify the direction into a concrete style guide.** When a game adopts an art
  direction — whether the user specified it or you chose one — write it down as
  explicit, reusable rules in the game's folder: exact color palette (with
  values), typography, shape language, line weights, spacing/scale, lighting and
  shadow treatment, animation character, and any motifs. A vibe in your head
  drifts asset to asset; a written spec keeps everything coherent. Keep these
  docs under `games/<game>/docs/`, one topic per file (e.g. `DESIGN.md` for what
  the game is and its mechanics, `PALETTE.md` / `RENDERING.md` / `LIGHTING.md` for
  the look, `ARCHITECTURE.md` for the code), and index them from the game's
  `README.md`. **One fact, one home:** the design doc owns what the game is, the
  art docs own the look — don't restate either in `README.md` or a game `CLAUDE.md`,
  link to them, so information can't drift across files.
- **Every asset and every piece of art follows the guide.** Treat it as the
  single source of truth — new art references it, and anything that violates it
  is a bug to fix, not a variation to keep. Consistency is most of what makes a
  game look intentional rather than assembled.
- **Evolve the guide deliberately, not incidentally.** If the direction needs to
  change, update the spec first, then bring existing assets in line — don't let
  the style fork silently across the game.

## Playtest your own work

- **Don't ship a change you haven't experienced.** The human will playtest and
  give feedback, but that's the last line of review, not the first. Before
  handing anything over, the agent must exercise the game itself and form its own
  judgment about whether it feels right — then act on that feedback.
- **Play it for real when you can.** Drive the actual game — launch it and feed it
  real inputs (browser automation, an input-simulation harness, a scripted
  controller) — and observe the result: screenshots, recordings, logged state,
  frame timings. Seeing the real thing catches feel and presentation problems
  that reading code never will.
- **Simulate a playtest in code when you can't.** Where driving the live game is
  impractical, run the simulation headlessly: play through sequences
  programmatically, assert the outcomes, measure difficulty/pacing/balance, and
  fuzz inputs to surface soft-locks, dead ends, and degenerate strategies.
- **Critique honestly and specifically.** Turn the playtest into concrete,
  actionable notes — "the win feedback is too subtle," "this level is unsolvable
  after move 3," "input feels sticky when mashed" — and fix them before the human
  ever sees it. The goal is to arrive at human playtesting with the obvious
  problems already gone.

## Standardize shared code

- **When two or more games need the same thing, extract it.** Common helpers,
  utilities, algorithms, and patterns (easing, RNG, particle emitters, input
  buffering, save/load, audio synthesis, geometry) that start getting copied
  between games should graduate into a shared module under `shared/`, importable
  by any game in the workspace.
- **Don't abstract prematurely.** Let a helper prove itself in one game first;
  extract on the *second* real use, not in anticipation of one. Copying once is
  fine — copying a third time means it should already be shared.
- **Keep shared code genuinely general.** A `shared/*` module must not depend on
  any single game's specifics; if it needs game-specific behavior, that belongs
  in the game, not the shared layer. Shared code that leaks one game's
  assumptions is worse than a little duplication.

## Use known, proven solutions

- **Most game problems are already solved.** Pathfinding, collision, spatial
  partitioning, easing, procedural generation, shuffling, RNG, state machines,
  networking — the well-studied algorithm almost always exists and is better than
  what you'd invent under time pressure. Reach for the established, named
  technique first.
- **Don't guess or improvise a solution that likely already has a canonical
  form.** A hand-rolled approximation of a solved problem is how subtle bugs and
  bad feel sneak in.
- **If you're unsure, research before you build.** Confirm the standard approach,
  its trade-offs, and its edge cases, then implement it deliberately — rather than
  discovering the hard way why the well-known method is well-known.

## Self-document

- **Record the decisions, not just the code.** When you add a feature, change a
  mechanic, or make a non-obvious call, capture *why* — the reasoning and
  trade-offs are what a future reader (human or agent) can't reconstruct from the
  diff alone.
- **Git is the primary ledger.** Commit messages must be verbose and contextual:
  what changed, why, and any consequence or follow-up — not "fix" or "update".
  A good history means the project can be understood by reading its commits.
- **Use branches and issues liberally and effectively.** Do meaningful work on
  branches, track intent and bugs as issues, and keep them tightly scoped — one
  concern each, small enough to review and merge cleanly.
- **Scope every branch and issue to the game being worked on.** In this
  multi-game directory, a branch or issue belongs to a single game; name it so
  that's obvious (e.g. prefix with the game's folder). Cross-cutting work on
  shared code is its own scope, separate from any one game.
- **One GitHub Project per game.** Each game has its own Project (Projects v2,
  owned at the user/org level since Projects aren't per-repo, linked to this
  repo) — that's how per-game work stays separated in the monorepo. Give every
  game issue the game's label and a `<game>:` title prefix, and add it to that
  game's Project; track larger directions as an epic/tracking issue that
  checklists its child issues. Manage it all from the CLI (`gh issue`,
  `gh project`; the token needs the `project` scope). Keep a simple Todo /
  In Progress / Done status board so the game's state reads at a glance.

## General engineering notes

- **Prefer the simplest stack that delivers the feel** — vanilla HTML + JS +
  Canvas is usually enough. No build step, no framework, no dependencies until the
  game genuinely outgrows going without.
- **Drive animation from elapsed time, not frame counts,** in a
  `requestAnimationFrame` loop, so motion is a pure function of a timestamp:
  framerate-independent, trivially interruptible, and resume-safe.
- **Invalidate stale scheduled effects.** When the game resets, reloads, or
  branches, deferred callbacks (delayed sounds, particle bursts, timers) from the
  abandoned state must abort instead of firing on the new state — a generation/
  epoch counter is a simple, reliable guard.

## Web platform

Every game is a browser game, so these apply to all of them.

- **The play area is a `<canvas>`, always** (2D/WebGL/WebGPU) — never DOM
  elements, text characters, or emoji standing in for game objects. Surrounding
  chrome (menus, HUD, buttons) can be HTML/CSS.
- **Be responsive and mobile-first-capable.** The game should scale to fit any
  viewport (fluid canvas/layout, not fixed pixel sizes) and stay playable from
  phone to desktop. Detect the device (e.g. `matchMedia('(pointer: coarse)')`)
  and adapt: touch gets native inputs (swipe, tap, drag) and larger targets;
  desktop gets keyboard/mouse.
- **The UI must reflect the platform.** Don't show keyboard/mouse bindings on a
  touch device — they're noise and imply controls that don't exist. Swap prompts
  accordingly ("tap to continue" vs "press space"), and hide desktop-only affordances on mobile and vice versa.
- **Prefer modern, native Web APIs over libraries and hand-rolled code.** The
  platform ships a lot for free — Web Audio for sound, Vibration for haptics,
  Pointer/Touch events for input, `requestAnimationFrame` for the loop, Gamepad,
  Fullscreen, Screen Orientation, Web Storage, Canvas/WebGL/WebGPU, etc. Reach
  for these before adding a dependency. Live reference:
  https://developer.mozilla.org/en-US/docs/Web/API — check it for the current API
  and browser support rather than relying on memory.
