# DELVE — UI

The interface's **art direction and architecture**: what the surfaces are, which layer draws each
one, and the rules that keep the chrome looking like it belongs to the game. What the game **is**
lives in [DESIGN.md](DESIGN.md); the world's look lives in [PALETTE.md](PALETTE.md),
[RENDERING.md](RENDERING.md) and [LIGHTING.md](LIGHTING.md).

> **Status: specified, partly implemented.** What ships today is a title screen, a top bar, a HUD,
> three overlay panels (Inventory, Collection, pause) and a touch pad, written as plain HTML with an
> inline `<style>` block in `client/index.html` plus `client/src/ui/inventory.ts`. Screen flow runs
> through the **app state machine** (`title | playing | paused`, see
> [ARCHITECTURE.md](ARCHITECTURE.md#state-machines)). None of the *art-direction* rules below are
> applied yet, and one behavioural rule is currently **inverted** — see
> [Panels never pause](#panels-never-pause). Tracked by
> [#28](https://github.com/inman-sebastian/agent-games/issues/28).

## The problem this doc exists to fix

The current UI reads as a web page laid _over_ a game rather than part of one. That's measurable,
not a matter of taste:

|                                                               |       |
| ------------------------------------------------------------- | ----- |
| Colours the UI stylesheet defines (`:root` custom properties) | 8     |
| Of those, present anywhere in the game's authored colours     | **1** |
| Glyph characters standing in as button art (`▣ ✦ ♪ ↺ ◄ ► ⤒`)  | 7     |
| Pixel grids on screen at once                                 | 2     |

The game's authored palette surface is 63 distinct colours across the strata ramps and ore triads.
Exactly one of the UI's colours appears in it — `--ink: #e8eef5`, which happens to be **silver's
highlight**, and is coincidence rather than intent. [PALETTE.md](PALETTE.md) opens by stating that
_every_ colour in DELVE is drawn from Resurrect 64, so this isn't mere inconsistency: **the UI is in
documented violation of the art direction.**

On top of the private palette it uses three materials the renderer **cannot produce anywhere in the
world**: antialiased corner radii, a backdrop blur, and smooth eased transitions. Nothing in a
Resurrect-64 pixel scene makes a gaussian blur or a subpixel-antialiased curve. And the glyph icons
are **found assets**, which the art direction forbids outright.

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

| Surface                       | Kind        | Made of                          | Blocked on                       |
| ----------------------------- | ----------- | -------------------------------- | -------------------------------- |
| **Action bar**                | Persistent  | Slots + icons; assignable, paged | Equipment existing               |
| **Mini map**                  | Persistent  | **World render**                 | Bounded world; a _memory_ system |
| **Inventory**                 | Invoked     | Slots + icons, scrolling         | —                                |
| **Character / equipment**     | Invoked     | Slots + icons                    | Equipment, slot progression      |
| **Crafting menu**             | Invoked     | Slots + recipe text, scrolling   | The crafting tree                |
| **Codex**                     | Invoked     | Prose, scrolling _(exists)_      | —                                |
| **Full map**                  | Invoked     | **World render** + chrome        | Bounded world; a _memory_ system |
| **Character select / create** | Pre-session | Roster + creation form           | Portable characters              |
| **World creation**            | Pre-session | Settings form                    | Size presets                     |

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

## Panels never pause

**The world keeps running while a game panel is open.** This is a first-class design decision, not a
consequence of multiplayer.

**Two kinds of surface, and only one of them may pause:**

| Kind | Examples | Pauses? |
| ---- | -------- | ------- |
| **App screen** | Title, pause menu | **Yes** — that's what they're for |
| **Game panel** | Inventory, codex, crafting, character, maps | **Never** |

- Every game panel must be **safe to browse while something walks toward you** — which rules out
  opaque full-screen panels.
- The player is **deliberately vulnerable during inventory management**.
- **No panel may block the frame loop**, and input routing has to decide **per key** whether the UI
  or the game receives it.
- Reading the map is itself risky, which is a good property for an earned surface.

> **The code currently does the opposite, and this is the change to make.** `openMenu()` in
> `client/src/index.ts` calls `app.send('pause')`, and the Inventory and Collection overlays both go
> through it — so opening either one pauses the sim today. The app machine's `paused` state is
> correct for the **pause menu**; game panels need a path that opens an overlay *without* leaving
> `playing`.

## Non-negotiables

- **Never a found asset.** No emoji, no clip art, no downloaded icon fonts. Every glyph and frame is
  drawn in code on the [Resurrect-64](PALETTE.md) palette.
- **Accessibility is not traded for cohesion.** Keyboard navigation, focus order, and screen reader
  output survive every decision here — that's the main reason the DOM keeps the document surfaces.
- **Responsive and device-aware.** The UI scales from phone to desktop, touch gets native inputs and
  larger targets, and prompts match the device — never show keyboard bindings on a touch device.
- **One palette.** If a colour isn't in Resurrect 64, it isn't in the UI — same rule as every other asset ([PALETTE.md](PALETTE.md)).
