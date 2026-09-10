# DELVE — code style

The overriding rule: **source code is written for humans.** Optimize every file for
someone reading it cold — clarity and structure over cleverness or brevity. Vite minifies
for production, so there is **no reason to hand-compact code**; terse, minified-looking
source is a bug to fix, not a style to keep.

This is a reaction to the earlier vanilla-JS phase, which leaned on dense one-liners and
one-letter names to keep single files small. That constraint is gone (modules + a build
step), so the code should read like prose.

## Readability (the non-negotiable)

- **One statement per line.** No multiple statements crammed onto a line with `;`. No
  packing a whole algorithm into a single expression.
- **Descriptive names, full words.** `lampBrightness`, `tileColumn`, `attenuation` — not
  `lb`, `tc`, `a`. Short conventional names are fine *only* where they're universal and
  local: loop counters `i`/`j`, math coordinates `x`/`y`/`dx`/`dy`, and a lambda's obvious
  single arg. Everything with meaning gets a real name.
- **Name intermediate results.** Break a complex expression into named steps rather than a
  nested chain. A well-named temp is a free comment.
- **Small, single-purpose functions.** If a function needs section comments to be
  navigable, it probably wants to be several functions.
- **No deeply nested ternaries.** One level is fine; beyond that use `if`/`else` or a
  lookup.
- **Match the surrounding code.** Consistency beats personal preference; the standard
  applies equally to new code and ported code.

```ts
// avoid — compacted, cryptic (the old style)
for (let i=0;i<n;i++){const a=at(i),b=a>t?a:t;d[i]=b*.85|0;}

// prefer — readable
for (let index = 0; index < count; index++) {
  const sample = valueAt(index);
  const brightness = Math.max(sample, threshold);
  darkness[index] = Math.floor(brightness * DARK_SCALE);
}
```

## No magic values

No bare, unexplained numbers or strings in logic — **ever**. Any value that carries meaning
(a tuning knob, threshold, dimension, seed/salt, key, limit, colour) is a named constant with
a comment saying **what it is and why it's that value**.

- Hoist tuning constants to the top of the module (or a shared config) with `SCREAMING_SNAKE`
  names, one rationale line each. Tuning the game should mean editing a named, documented value.
- The only literals allowed inline are the trivially self-evident: `0`, `1`, `-1`, small loop
  bounds, and array indices, where the meaning is obvious from the immediate context.
- A formula that uses a *family* of coefficients (procedural-art harmonics, a PRNG's mixing
  primes) is documented as a set where it's defined, rather than atomised into a dozen names
  when that would hurt readability — but the block still says what it is and why.
- Prefer an `as const` lookup/table over scattered literal branches.

## DRY — don't repeat yourself

- A rule, constant, formula, or shape lives in **exactly one place** and is imported/derived
  everywhere else. This is already the project's spine (one shared engine, `blocks.js` as the
  single world source, entity resources, one-fact-one-home docs) — hold the line in TS.
- Copied-and-tweaked code is a smell: extract a well-named helper the second time you'd write
  it (copying once is fine — extract on the second real use, per the root `CLAUDE.md`).
- Don't restate a value the type system or a constant can give you; derive it.

## Return early — the bouncer pattern

Guard clauses at the top, main path unindented at the bottom. Handle the invalid / edge /
early-exit cases first and `return` (or `continue`/`break`) immediately, so the happy path
isn't buried in nested `if`s. Return early, return often.

```ts
// avoid — happy path nested inside guards
function sell(state: SaveState): number {
  if (hasCargo(state)) {
    if (marketOpen(state)) {
      // ...the real work, two levels deep...
    }
  }
  return 0;
}

// prefer — bounce out early, main path flat
function sell(state: SaveState): number {
  if (!hasCargo(state)) return 0;
  if (!marketOpen(state)) return 0;
  // ...the real work, at the top level...
}
```

Applies to loops too: `if (!solid) continue;` up top beats wrapping the body in `if (solid) { … }`.

## TypeScript

- **Type the public surface.** Exported functions get explicit parameter and return types;
  exported data gets an `interface`/`type`. Internal locals can lean on inference.
- **Model the domain with types.** Entities (ore/strata resources), the save/sim state, and
  the future client/server protocol are `interface`s in one place, shared by every consumer.
- **No `any`.** Reach for `unknown` + narrowing, generics, or a proper type. `// @ts-expect-error`
  only with a comment explaining why.
- **`const` by default**, `readonly` for data that shouldn't mutate, `as const` for literal
  tables.
- **Prefer named exports.** One concern per module; avoid default exports.

## Comments

- Keep the project's doc-comment culture: a short header on each module saying what it is and
  why, and comments that explain **why** (decisions, trade-offs, non-obvious math) — not what
  the code already says. Readable code needs fewer "what" comments, not more.
- **Dense math must be explained.** If a loop or formula is inherently compact for
  performance, name its variables clearly *and* comment what it computes and why it's shaped
  that way.

## Performance vs. readability

Readability first. Only optimize with a measurement, and when you do:

- keep names and structure clear even in the hot path (a fast loop is not an excuse for
  `d[j]=s*255`),
- leave a comment explaining the optimization and its ceiling (this pairs with the
  `ponytail:` convention in the root `CLAUDE.md`).

The lighting composite is the reference case: it's performance-critical, but it still uses
named fields and explains the tile-res-upscale technique.

## Formatting

- **Prettier owns formatting** (`pnpm format`); don't hand-format. Config: 2-space indent,
  semicolons, single quotes, ~100-column width, trailing commas.
- `pnpm typecheck` (`tsc --noEmit`) must be clean before a change is done.

## Scope

Applies to all DELVE source — client, server, shared modules, resource files, and tools.
When porting old terse JS to TS, **expand it to this standard as you go**; don't
transliterate the compaction.
