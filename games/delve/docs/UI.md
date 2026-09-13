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
| Typefaces that are not pixel type                            | 1    | **0**               |
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
test asserts both do and that the game inlines no `<style>` of its own. A lab that restyled its own
chrome would be a second art direction — the exact thing this doc exists to prevent.

The lab lays every surface out at once **over real cave**, drawn through the game's own compositor
and lighting pass, so a panel's contrast is judged against the thing it will actually sit on: lit
rock, unlit rock, ore, and the hard boundary between them. It started as a banded gradient
stand-in, which read as ribbons and tested almost nothing. Capture the lot with
`BUDGET=8000 tools/shot.sh 'w=62&h=44&scale=1' out.png labs/ui-lab.html`.

**The debug overlay stays a real monospace** (`--font-mono`), and that is a decision rather than an
omission: it prints aligned columns of live numbers, which is the one job a proportional pixel face
makes worse. It is a tool, not chrome.

### Typography — decided: Silkscreen + Jersey 15

The stylesheet work removed every soft material from the interface, which made the one remaining
soft thing obvious: a **system sans** inside hard-edged boxes is now the loudest tell that the UI is
not part of the game.

`client/labs/font-lab.html` renders DELVE's real chrome in each candidate, because a font cannot be
judged from a specimen sheet. What matters is whether it survives the **four jobs** the game actually
asks of it, at the sizes they appear:

1. the **wordmark** (display, ~44px)
2. a **button label** (short, sentence case)
3. a **tabular HUD number** (must align, must read at a glance)
4. a **full sentence** of ore description

Most pixel faces pass the first three and fail the fourth, so job 4 is the decision. Capture with
`BUDGET=8000 tools/shot.sh 'only=silkscreen,vt323&w=58&h=46&scale=1' out.png labs/font-lab.html` —
the budget flag is required, since capturing at `load` shoots every candidate as an invisible
fallback.

| Candidate | Grid | Reads as | Job 4 |
| --- | --- | --- | --- |
| Silkscreen | 8px | a classic 8px UI face, superb wordmark | lowercase renders as small caps, so prose SHOUTS |
| Pixelify Sans | 5px | true lowercase, variable weight | the most prose-capable of the set |
| Jersey 15 | 15px | blocky, substantial, stone-like | comfortable |
| Jersey 10 | 10px | tall and condensed, fits a lot | comfortable, lighter |
| VT323 | 8px | a CRT terminal — a machine, not stone | fine, but wrong genre for a mine |
| Handjet | 8px | machine-stamped dot matrix, distinctive | thin and effortful |
| Press Start 2P | 8px | the NES face | fails — one sentence costs four lines |
| Micro 5 | 5px | the smallest legible pixel type | too small to be the body face |

**A pairing, because no single face did all four jobs.**

- **Silkscreen** carries everything **short**: wordmark, headings, buttons, HUD, labels. Used at
  16px and 40px — whole multiples of its 8px design grid, or it stops being crisp, which is the only
  reason to use a pixel face at all. Its lowercase renders as small caps, which is exactly right for
  a label and exactly wrong for a sentence.
- **Jersey 15** carries **prose**: ore descriptions, subtitles, the tagline. True lowercase,
  comfortable at paragraph length, and blocky enough to sit beside Silkscreen without arguing.

Prose is the **only** thing that gets the body face; everything else is display. The split is one
grouped rule in `ui.css`, so moving a surface between them is one line.

**Self-hosted**, not fetched: `client/src/ui/fonts/`, four `.woff2` files totalling 16 KB, with
licence and attribution in `OFL.txt` (both families are SIL OFL 1.1, which permits bundling in a
game). The game must not hand a third party a request on every load, and it must boot offline.
`font-display: block` rather than `swap` — a brief invisible label beats a flash of system sans
reflowing the whole interface, since these faces have very different metrics from a fallback.
`tools/style.test.ts` asserts the stylesheet fetches nothing remote, sizes type only through the
tokens, and keeps every display size on the 8px grid.

**Jersey 10** is bundled alongside as the live alternative for the prose face — condensed, fits more
per line, worth a look if the inventory and codex lists get dense. Swap `--font-body` and delete the
loser. **Pixelify Sans** was rejected on look. Two strong candidates are not on Google Fonts and are
worth reaching for if the prose face needs replacing: **Departure Mono** (OFL) and **Pixel
Operator** (CC0), both full families rather than single faces.

Every candidate here is openly licensed (OFL or CC0). A licensed typeface is chrome, not a found
game asset — the art direction's ban is on emoji, clip art and stock images standing in for art the
agent should author, and it is satisfied by a font the way it is by a system sans.

### Panel frames — built, and one rejected approach

Nine-slice `border-image`, the standard way to get a stylised panel in the DOM: a small source is cut
into a 3×3 grid, the corners are placed as-is, the edges tile, the middle fills. One 7×7 source
dresses a panel of any size, and with `image-rendering: pixelated` it scales without a blurred pixel.

**Drawn in code** (`client/src/ui/surface.ts`), generated at startup — canvas → data URL → custom
property. No asset file to keep in sync, no build step, and no second home for the palette, since
the colours are read back out of the stylesheet's own roles.

Three rings and a face:

| Ring | What |
| --- | --- |
| 0 | the hard outline — what separates a panel from the rock behind it |
| 1 | the bevel lip, lit top-left and shaded bottom-right |
| 2 | **optionally** (`well`) the same lip inverted, turning the content area into a shallow well |
| middle | the face — **flat**, tiling across the panel |

**The well is opt-in, and that is the fix for a real bug.** Applying it to every frame put the lit
lip at *different depths on opposite sides* — depth 1 where the outer bevel shades, depth 2 where it
lights — so the frame drew two L shapes one pixel apart that could never meet. On a large panel that
reads as a rim, which is why it survived several looks. On a 20-pixel slot it reads as exactly what
it is: disconnected, unevenly offset lines. **A recess is a single lip, always.**

**Ring 2 is where a panel gets its substance.** A single bevel reads as a raised rectangle; a bevel
with an opposed inner lip reads as a frame *around* something, which is what a panel is. One pixel,
no texture. Variants are on the bench in `client/labs/panel-lab.html` — flat-and-outline, single
bevel, this one, corner rivets, and the rejected textured version as a counter-example.

Learned by looking, each now held by a test:

- **The shade must be darker than the face.** The first version used the mid grey, which is *lighter*
  than the panel, so the bottom and right read as lit too and the plate looked swollen.
- **The inner lip must oppose the outer bevel**, or the frame just looks thicker.
- **A control's face is one ramp step lighter** than a panel's, or three pixels of bevel has to do
  all the work of saying "this is a button".
- **The lit step is two ramp steps above the face, not three.** At three it is the same value as the
  body text, so the frame competes with what the panel is *for*. A bevel is a lighting cue, and a
  lighting cue that outshines everything else stops being one.
- **Shade wins where lit and shade meet.** Painting every bevel corner dark looks principled — a
  corner cannot pick a side — and produces a lit top run starting one pixel in from the left and a
  lit left run starting one pixel down, which never meet. It reads as two detached lines hanging off
  the panel. The convention leaves one continuous lit L and one continuous dark L, and it exists
  precisely because the alternative is visible immediately.
- **The hard drop shadow is two art pixels, not four.** Deeper reads as a slab behind the panel
  rather than the panel lifting off the rock.

`client/labs/panel-lab.html` varies one decision at a time against real rock with real text on it —
the lit step at one, two and three, and the drop shadow at four, two and none.

#### Why there is no texture in the interface

Worth recording, because it was shipped and reverted.

A version gave every surface a uniform hash-noise mottle and dithered the frame's inner ring, on the
reasoning that the UI should share the rock's *materials* and not merely its palette. It read as a
mistake — "the small repeating background pattern looks distracting and looks like a mistake, the
hashing pattern around the edges looks weird too." The research is unanimous about why:

- **"Keep it off small sprites, moving regions, and UI."** ([Pixnote, dithering](https://pixnote.net/en/learn/dithering/))
- Under roughly 8–10px of run, **"skip the dithering and use a solid colour or a single-pixel shade
  shift instead"** (ibid). The frame's transition ring was **one** pixel wide.
- At small sizes **"there's no room for a pattern to read; it just looks noisy"**
  ([Spearite](https://spearite.com/blog/pixel-art-dithering-guide)).
- **"Generally you want to avoid mechanical dithering and opt for a pattern based effect instead"**
  ([alain.xyz](https://alain.xyz/blog/pixel-art-design-for-game-dev)).
- **"A dark outline reads at any size and is the safe default"**
  ([Pixnote, game assets](https://pixnote.net/en/learn/game-assets/)).

**The through-line: in pixel art UI, texture comes from deliberate, placed detail** — a corner rivet,
an inner line, a header band — **not from uniform noise.** Dithering belongs to large areas and
gradients (skies, metal, lighting falloff), and a panel is neither, because a panel has text on it.

So **sharing an art direction means sharing the palette, the grid, the hard edges and the light
direction.** It does not mean running the rock's shader over the chrome. That distinction is the
correction to the reasoning in the stylesheet section above, which was right about the diagnosis and
wrong about the remedy.

Reference for browsing real examples: [Game UI Database](https://www.gameuidatabase.com/) (1,300+
games, 55,000+ screenshots, filterable by style and colour) and
[Interface In Game](https://interfaceingame.com/).

## Icons and the slot widget — built

**Four surfaces are the same widget.** The action bar, the inventory, the equipment screen and a
crafting recipe's ingredients are all a square holding an item icon, a count and a state. Built once
as `<delve-slot>` (`client/src/ui/slot.ts`), so the other three come nearly free.

**A custom element**, per the component decision above — native, no dependency. This is the case
where **Shadow DOM earns itself** rather than being applied on principle: a slot appears dozens of
times on a screen, and the boundary makes the palette-via-custom-properties discipline *mandatory*
rather than encouraged. Custom properties are the only styling that pierces a shadow root, so a slot
is themed by the same `--c-*`, `--px` and `--frame-*` roles as everything else and cannot invent a
colour even by accident.

| State | Reads as |
| --- | --- |
| `empty` | an inset recess with a drawn pip |
| `filled` | the material, plus a count when it is more than one |
| `selected` | a **lit gold outline** — the way every inventory since the 16-bit era has said "this one" |
| `locked` | dimmed; progression has not opened this yet |
| `unaffordable` | icon dimmed, count in gold; you lack the materials |

`locked` and `unaffordable` are deliberately distinct. Both mean "not right now", but one is answered
by playing on and the other by going and mining.

**The empty state is a requirement, not polish.** It is what a new player sees most, and an actually
blank box reads as a rendering failure rather than as a place something goes. So it is *drawn*: the
inset frame plus a centred pip.

### Icons render through the game's own compositor

An inventory slot shows the material **as it actually appears in the world**, not an imitation of it.
`client/src/ui/icon.ts` composes a real 3×3 band through `composeBand` with the ore's own material
and crops the middle tile. Every shader, dither and bit of world-anchored texture comes along for
free because none of it is reimplemented — **cohesion by construction**, the same argument the
material system won on. When a material's shader changes, its icon changes with it, and there is no
second definition to forget.

The band is solid **except for one open tile directly above the centre**, which is the shape an
exposed vein face actually has underground: the top edge catches light and the rest of the tile stays
whole. Leaving the centre isolated was the first attempt and produced a small blob — the compositor
erodes a tile's boundary against open space, so open on all four sides is eaten from every direction
at once. Correct behaviour, wrong request.

Three sizing rules, all learned by looking:

- **A slot is 20 art pixels** with a one-pixel edge, so the icon fills the square rather than
  floating in it. **The icon cannot simply be drawn bigger**: it is one 16px world tile, so the only
  sizes that keep the pixels square are whole multiples — 16 or 32, nothing between. 32 needs a ~36px
  slot, and six of those do not fit across a panel. So the icon stays 1:1 and the slot tightens
  around it, which is the same result by the only means available.
- **Sizes are in CSS pixels, and one art pixel is two of them.** This caught *both* the count and the
  icon, separately, which is what makes it worth writing down. The count was set at Silkscreen's
  native 8px and the icon was asked for at "16" — both look like art-pixel numbers, both mean CSS
  pixels, and both rendered at half the scale of everything else on screen. The icon is now
  `ICON_PX` (a named constant, `T × UPSCALE`) rather than a number a caller picks, and the count is
  16px, which is 2× native.
- **A drop shadow is ONE offset copy.** The count had four, one per side, which is an *outline* — and
  a poor one, because four axis-aligned copies leave the diagonals unfilled, so it never closed
  around a letter and read as a detached blocky halo. One hard copy, one art pixel down and right,
  in white over the item's own texture.
- **A count uses the badge face, not the display face.** Micro 5 is drawn on a 5px grid, so at 10px
  it is 2× native and **5 art pixels tall**. Silkscreen's smallest on-grid size is 8, and at that
  height a three-digit count read as a label stretched across the item rather than a number tucked in
  its corner. Staying on the grid is not negotiable, which is *why* the answer was a different face
  rather than a smaller size.
- **An icon is a perfect square.** An item in a slot is an object, not a piece of the world, and a
  bitten corner reads as damage. The compositor erodes a tile wherever it meets open space, so the
  icon's tile is buried with its opening **two rows up** — far enough that nothing erodes it, and the
  lighting is then remapped through the material's own shader (a brightness floor plus some of the
  geometric variation). Remapping rather than filtering matters: the shader still picks every colour
  from its own ramp, so this can only choose a *lighter band* and can never invent an off-palette
  colour the way a canvas filter would. It is the one place an icon knowingly departs from the
  in-world look, and it departs in the only dimension that does not touch the art direction.
- **Every icon samples a different world position.** The compositor's erosion and texture are
  world-anchored, so icons sampled at the same coordinates all get the identical eroded corner.
  Twelve of those in a grid stops reading as texture and starts reading as a defect. Spacing them
  gives each material its own chip for free.
- **The edge is one pixel, and it is a theme decision** (`--slot-edge`, `--slot-edge-w`), not the
  widget's. A slot started with the full inset frame — three pixels of bevelled recess — and a slot
  is repeated a dozen times in a grid, so whatever it spends on furniture it spends twelve times
  over. The frames ended up louder than the materials in them. Alternatives are benched in
  `client/labs/panel-lab.html`: one pixel, none at all, two pixels, and the rejected inset frame.

That last one generalises, and it is the third time this pass has taught it: **a treatment that reads
well once can read badly repeated.** A panel appears alone and can afford a frame. A slot appears
twelve times and cannot.

This also retires the last of the glyph characters standing in as art in these panels: the codex's
`?` for an undiscovered material is now a `locked` slot, which reads as something you have not got
rather than as missing data. The remaining glyphs are in the top bar and touch controls, and they
need authored icons rather than this pipeline — a verb has no material to render.

