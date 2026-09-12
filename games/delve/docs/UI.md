# DELVE — UI

The interface's **art direction and architecture**: what the surfaces are, which layer draws each
one, and the rules that keep the chrome looking like it belongs to the game. What the game **is**
lives in [DESIGN.md](DESIGN.md); the world's look lives in [PALETTE.md](PALETTE.md),
[RENDERING.md](RENDERING.md) and [LIGHTING.md](LIGHTING.md).

> **Status: specified, partly implemented.** What ships today is a title screen, a top bar, a HUD,
> three overlay panels (Inventory, Collection, menu) and a touch pad, written as plain HTML with an
> inline `<style>` block in `client/index.html` plus `client/src/ui/inventory.ts`. Screen flow runs
> through the **app state machine** (`title | playing | paused`, see
> [ARCHITECTURE.md](ARCHITECTURE.md#state-machines)) — whose `paused` state
> [should not exist](#nothing-pauses-ever). None of the _art-direction_ rules below are applied yet,
> and the never-pause rule is currently **inverted**. Tracked by
> [#28](https://github.com/inman-sebastian/agent-games/issues/28).

## The problem this doc exists to fix

The UI read as a web page laid _over_ a game rather than part of one. That was measurable, not a
matter of taste — and the first three rows are now **fixed** ([#43](https://github.com/inman-sebastian/agent-games/issues/43)):

|                                                              | Was  | Now                 |
| ------------------------------------------------------------ | ---- | ------------------- |
| Colours the UI stylesheet defines                            | 8    | 9, **all R64**      |
| Of those, present in the game's authored colours             | 1    | **9**               |
| Materials the renderer cannot produce (radii, blur, easing)  | 3    | **0**               |
| Glyph characters standing in as button art (`▣ ✦ ♪ ↺ ◄ ► ⤒`) | 7    | 7 — see [Icons](#icons) |
| Pixel grids on screen at once                                | 2    | **1**               |

The one colour that used to overlap was `--ink: #e8eef5`, which happened to be **silver's
highlight** — coincidence rather than intent. [PALETTE.md](PALETTE.md) opens by stating that _every_
colour in DELVE is drawn from Resurrect 64, so this was not mere inconsistency: the UI was in
documented violation of the art direction.

The nine role colours are now the **Stone stratum's own six-step ramp** plus gold, the signal green
and the lamp cyan. Using the ramp rather than picking nine colours from the list is deliberate: the
panels are made of the same rock the player is looking at.

**The diagnosis is a second art direction, not a second technology.** Every tell above is reachable
from a stylesheet. So moving the UI to canvas would fix the clash only _incidentally_ — by forcing a
rewrite that happens to discard the defaults — while charging full price for it.

### Why not canvas

Recorded so it isn't relitigated. The cost lands precisely on the surfaces DELVE already has:

- **Text stops being text.** No reflow, no user font size, no selection, no find-in-page, no screen
  reader output, no input-method support for anyone typing a non-Latin script.
- **Layout and interaction become ours** — scroll containers, focus management, keyboard navigation
  and hit testing, all reimplemented.
- **Inventory and Collection are the worst case.** Scrollable lists of labelled items: the most
  expensive thing to rebuild in canvas and the cheapest thing the DOM already does well.
- **It contradicts a workspace rule** — HTML/CSS is for chrome, canvas is the play area. Going
  full-canvas would need to be a deliberate amendment, not a drift.

Full-canvas UI does ship on the web, overwhelmingly from engines exporting to it, and those builds
are exactly the ones known for unreadable text on high-density displays and broken assistive
technology.

## The split: world render vs document

**Divide by what a thing _is_**, not by how it should look.

- **Canvas** owns anything in world space or needing the art's pixel grid.
- **The DOM** owns anything that is fundamentally a document.

Two surfaces are **world renders** (the maps — downsampled pictures of the world). The rest are
**documents with canvas icons inside them**. That's the natural seam, not a compromise.

## Implementation: Web Components

All UI elements are built as
**[Web Components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components)** — native, no
dependency, and the fit is real: the shared vocabulary below maps one-to-one onto custom elements.

It satisfies two rules already in force: prefer modern native Web APIs over libraries, and **if the
game and a lab draw the same thing, they call the same module** — the browser labs
(`client/labs/*`) already duplicate game chrome, and importable elements are how that stops.

**Two scopes, decided separately:**

- **Custom elements: by default.** The element vocabulary and lifecycle are the point.
- **Shadow DOM: selectively.** It cuts both ways.
  - _For:_ it makes the [theming contract](#the-stylesheet-discipline) **mandatory**, since custom
    properties are the only styling that pierces the boundary — exactly the discipline this doc
    wants.
  - _Against:_ **ARIA references cannot cross shadow boundaries**, so cross-component labelling and
    focus get genuinely fiddly, and accessibility isn't tradeable.
  - _Rule:_ shadow DOM where encapsulation earns it (the **slot**, which appears dozens of times);
    light DOM where the component is mostly layout and wraps arbitrary content (the **panel frame**).

### The shared vocabulary

Settle these before building any surface — this is the UI equivalent of one compositor and many
materials:

**panel frame · slot · item icon · label · tooltip · focus ring**

## The stylesheet discipline

Four rules. Together they put the UI on the game's grid instead of the browser's.

1. **One shared pixel unit.** Export the art's upscale factor as a CSS custom property and express
   every padding, border, radius and icon size as a multiple of it. The art is 16 logical px per
   tile, upscaled 2× (see [RENDERING.md](RENDERING.md)).
2. **Every UI colour is a Resurrect-64 colour**, sourced from the game's palette rather than from
   hexes in a `<style>` block. Two palettes in one game is a one-fact-one-home violation, and it has
   already drifted — 7 of the current 8 aren't in the game's palette at all.
3. **Delete the impossible materials.** No blur, no smooth gradients, no antialiased radii.
   Hard-offset shadows and hard-stop gradients read as pixel art.
4. **Quantise motion.** `steps()` timing, so movement lands on pixel boundaries rather than between
   them.

Custom properties are the mechanism that makes all of this survive Shadow DOM, so rule 1 and rule 2
_are_ the theming contract every component depends on.

**Built, and gated.** The stylesheet is `client/src/ui/ui.css`, and `tools/style.test.ts` asserts
every rule above as a property rather than as a value — so restyling freely is fine and drifting is
not. It checks that `--px` still equals `UPSCALE` in `render/palette.ts`, that every length off
`:root` is a whole multiple of it, that every colour is an R64 member (alpha suffixes allowed, since
alpha is not a new colour), that no hex appears outside the role definitions, that nothing uses blur
or a radius, that every transition is quantised, and that every gradient bands rather than blends.

All four rules were reachable by typing a hex into a style block, which is how the drift happened
the first time; a written rule would have drifted again.

**One stylesheet, every page.** The game and `client/labs/ui-lab.html` link the same file, and the
test asserts both do and that the game inlines no `<style>` of its own. The lab lays every surface
out at once against a banded stand-in for the rock, so the whole interface is one screenshot
(`tools/shot.sh 'w=62&h=42&scale=1' out.png labs/ui-lab.html`). A lab that restyled its own chrome
would be a second art direction — the exact thing this doc exists to prevent.

### Panel frames

Nine-slice `border-image` — the standard technique for a stylised panel in the DOM. **Draw the frame
in code** at startup (canvas → data URL → custom property), which satisfies the create-every-asset
rule and needs no build step or asset file. With `image-rendering: pixelated` it tiles to any panel
size without blur.

## Icons

**Two categories, two pipelines.** This distinction matters because the first is the cohesion win
and the second can't use it.

- **Materials → rendered with their real shaders**, into a small canvas inside the component. An
  inventory slot shows the _actual_ material as drawn in the world. This is cohesion **by
  construction rather than by imitation** — the same principle the material system already won on —
  and it's what kills the seven glyphs.
- **Abilities → authored glyphs, drawn in code.** A grapple or a jetpack burst has no material to
  render, so verbs need hand-authored icons on the palette. Different job, same rules: no emoji, no
  found art.

## The surfaces

| Surface                       | Kind       | Made of                          | Blocked on                       |
| ----------------------------- | ---------- | -------------------------------- | -------------------------------- |
| **Action bar**                | Persistent | Slots + icons; assignable, paged | Equipment existing               |
| **Mini map**                  | Persistent | **World render**                 | Bounded world; a _memory_ system |
| **Inventory**                 | Invoked    | Slots + icons, scrolling         | —                                |
| **Character / equipment**     | Invoked    | Slots + icons                    | Equipment, slot progression      |
| **Crafting menu**             | Invoked    | Slots + recipe text, scrolling   | The crafting tree                |
| **Codex**                     | Invoked    | Prose, scrolling _(exists)_      | —                                |
| **Full map**                  | Invoked    | **World render** + chrome        | Bounded world; a _memory_ system |
| **In-game menu**              | Invoked    | Settings, leave-world _(exists)_ | —                                |
| **Character select / create** | Pre-game   | Roster + creation form           | Portable characters              |
| **World creation**            | Pre-game   | Settings form                    | Size presets                     |

**Four of these are the same widget.** Action bar, inventory, equipment slots and crafting
ingredients are all a slot holding an item icon with a count and a state (empty / filled / selected
/ locked / unaffordable). Build the slot once and four surfaces come nearly free — which is why the
slot plus the icon pipeline is the first thing to build.

**The maps are not a rendering of where you've been.** There is no persistent explored/seen memory
in the lighting model — walk away from a tunnel and it returns to the void. A map is therefore a
**new memory system**, which is also what makes gating it thematically apt: acquiring one grants the
player a memory the game otherwise doesn't have.

### Gating

| Surface               | Available                         |
| --------------------- | --------------------------------- |
| Inventory, action bar | **Immediately**, never locked     |
| Mini map, full map    | **Earned** — a progression reward |

### The action bar

One bar with a **fixed footprint** and **multiple pages** the player toggles through, to which
almost anything can be assigned — the Satisfactory model.

**It's an _access_ layer, not a _capability_ layer.** Slots hold **references**, so assigning
something neither moves nor consumes it. Two consequences protect decisions made elsewhere: the bar
stays entirely out of the inventory-capacity system, and **unlimited pages don't undermine scarce
equipment slots**, because the scarcity that matters is what you _can_ do, not how fast you reach it.
Stated explicitly because limiting pages is a tempting way to "balance" the wrong layer.

- **Assignable:** equipped-gear abilities, tools, placeable materials, consumables.
- **Not assignable:** mining. It's the core verb; the player always has it.
- **It starts empty**, and empty slots are a **visible promise**. So an empty slot must read as
  _deliberately_ empty — a styled, inviting hole, never a missing icon. That's a requirement on the
  slot widget, not a polish pass. (It fills as soon as the player crafts their first torch.)
- **Paging must work on touch and gamepad**, not just number keys and a scroll wheel. Swipe across
  the bar and shoulder buttons are the natural mappings.

## Nothing pauses. Ever.

**There is no pause in DELVE.** It's an online game on a server-hosted world, so pausing isn't a
feature that was cut — it's a thing that cannot coherently exist. The world runs whether or not
you're looking at it.

That includes the menu. **A menu is not a pause**, and calling it a "pause menu" is the mistake that
let the current implementation happen.

### Pre-game vs in-game

The right division isn't screens-vs-panels, it's **whether you're in a world at all**:

| Phase        | Surfaces                                                           | The world                               |
| ------------ | ------------------------------------------------------------------ | --------------------------------------- |
| **Pre-game** | Title, character select, world creation                            | You aren't in one yet. Nothing to pause |
| **In-game**  | HUD, action bar, inventory, codex, crafting, character, maps, menu | **Always running**                      |

**The title screen isn't a menu and isn't part of the game** — it's _pre-game_, the step before you
enter a world. That's why it stops nothing: there's nothing running yet.

Everything in-game follows from that:

- Every panel must be **safe to browse while something walks toward you** — which rules out opaque
  full-screen panels, the in-game menu included.
- The player is **deliberately vulnerable** whenever a panel is open.
- **No panel may block the frame loop**, and input routing decides **per key** whether the UI or the
  game receives it.
- Reading the map is itself risky, which is a good property for an earned surface.

### Why the code currently pauses — and the real bug underneath

`openMenu()` in `client/src/index.ts` calls `app.send('pause')`, and the Inventory and Collection
overlays both route through it, so opening either one stops the sim today. The app machine's
`paused` state should not exist at all; the phases are **pre-game** and **in-game**.

But the deeper issue is on the server: **`physicsStep` runs on receipt of an input message, not on a
clock** (`server/src/index.ts`). Snapshots go out on a timer; the _simulation_ only advances when a
client sends input. So client-side pause "works" purely because **the server has no tick of its
own** — which is the thing that actually has to change.

Several decisions already depend on that clock existing: a **day/night cycle** needs time to pass,
**fluid** must keep flowing, **entities** must keep acting, and **world hibernation** ("a world with
nobody in it stops ticking") is only meaningful if there's a tick to stop. Once the server owns a
fixed tick, **pause becomes impossible by construction** — the correct end state, rather than a rule
the client has to remember to honour.

## Open questions

- **Is the UI an overlay, or diegetic?** Everything above assumes an overlay. A mining game has an
  obvious in-fiction home for a HUD — depth on a gauge, materials in a satchel, vision tied to a
  lamp the game already simulates — and **that is the only argument that legitimately moves UI onto
  the canvas**, since a diegetic interface lives in world space. It's a design question, not a
  technical one.

  It pulls hard against readability. A UI that lives in the world is maximally cohesive and
  *minimally legible*: lamp-lit, palette-quantised, occluded text is the same design that makes the
  world atmospheric, and atmosphere is the enemy of a glanceable depth readout. The likely
  resolution is a split — **diegetic for the ambient and persistent, overlay for the urgent and
  precise**. A lamp that dims as a mood signal is diegetic; the number telling you how deep you are
  is not.

- **Is the recipe book its own surface, or a view inside the crafting menu?** It's a separate system
  from the codex (which is a non-mechanical ledger), but that doesn't settle whether it gets its own
  panel.

## Non-negotiables

- **Never a found asset.** No emoji, no clip art, no downloaded icon fonts. Every glyph and frame is
  drawn in code on the [Resurrect-64](PALETTE.md) palette.
- **Accessibility is not traded for cohesion.** Keyboard navigation, focus order, and screen reader
  output survive every decision here — that's the main reason the DOM keeps the document surfaces.
- **Responsive and device-aware.** The UI scales from phone to desktop, touch gets native inputs and
  larger targets, and prompts match the device — never show keyboard bindings on a touch device.
- **One palette.** If a colour isn't in Resurrect 64, it isn't in the UI — same rule as every other asset ([PALETTE.md](PALETTE.md)).
