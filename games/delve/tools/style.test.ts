// style.test.ts — the UI stylesheet obeys the art direction (#43).
//
// The interface had a private art direction, and nothing stopped it: seven colours that appeared
// nowhere in the renderer, three materials the renderer cannot produce, and spacing on the browser's
// grid rather than the art's. Every one of those is reachable by typing a hex into a style block, so
// the fix is not only to correct the stylesheet but to make the correction hold.
//
// These assert the properties, not the current values — restyling freely is fine, drifting is not.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { R64, UPSCALE } from '../client/src/render/palette';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_CSS = join(HERE, '..', 'client', 'src', 'ui', 'ui.css');

/** The stylesheet with comments stripped, so a hex mentioned in prose is not a violation. */
const css = readFileSync(UI_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * One stylesheet, every page. The game and the UI lab link the SAME file, so a lab cannot restyle
 * the chrome — which would be a second art direction, the exact thing this file exists to prevent.
 */
const PAGES = ['index.html', 'labs/ui-lab.html'];

const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));

/** Every `prop: value` pair, as written. */
const declarations: { prop: string; value: string }[] = [
  ...css.matchAll(/([-a-z]+)\s*:\s*([^;{}]+)[;}]/g),
].map((m) => ({ prop: m[1], value: m[2].trim() }));

const palette = new Set(R64.map((hex) => hex.toLowerCase()));

describe('there is one UI stylesheet', () => {
  it('is linked by the game and by the lab, and inlined by neither', () => {
    for (const page of PAGES) {
      const html = readFileSync(join(HERE, '..', 'client', page), 'utf8');
      expect(html, `${page} links ui.css`).toMatch(/<link[^>]+ui\.css/);
    }
    const game = readFileSync(join(HERE, '..', 'client', 'index.html'), 'utf8');
    expect(game, 'the game has no inline <style> to drift into').not.toMatch(/<style>/);
  });
});

describe('the UI stylesheet is measured in art pixels', () => {
  it('--px is the art upscale', () => {
    // The whole point of a shared unit is that it is the SAME unit. If the art's upscale changes and
    // this does not, the interface silently stops sitting on the world's grid.
    const px = /--px:\s*(\d+)px/.exec(rootBlock);
    expect(px, ':root declares --px').not.toBeNull();
    expect(Number(px![1]), '--px matches UPSCALE in render/palette.ts').toBe(UPSCALE);
  });

  it('every length is a whole number of art pixels', () => {
    // Text is exempt: a font size is not a pixel-grid quantity, since glyphs are antialiased at any
    // size. Everything that draws a box — padding, border, offset, icon size — is not exempt.
    const TEXT = /^(font|font-size|line-height|letter-spacing)$/;
    const offenders: string[] = [];
    for (const { prop, value } of declarations) {
      if (TEXT.test(prop) || prop.startsWith('--')) continue;
      for (const [, n] of value.matchAll(/(-?\d*\.?\d+)px/g)) {
        const length = Math.abs(Number(n));
        if (length !== 0 && length % UPSCALE !== 0) offenders.push(`${prop}: ${value}`);
      }
    }
    expect(offenders, 'lengths off the art grid — use var(--px) or a multiple of it').toEqual([]);
  });
});

describe('the UI stylesheet draws from the game palette', () => {
  it('every colour is a Resurrect 64 member', () => {
    // Alpha is not a new colour, so an 8-digit hex is checked on its first six. A hex that is not in
    // R64 is a second palette, which is what this exists to prevent.
    const offenders = new Set<string>();
    for (const [, hex] of css.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
      const lower = hex.toLowerCase();
      const base = lower.length === 8 || lower.length === 6 ? lower.slice(0, 6) : lower;
      if (!palette.has(`#${base}`)) offenders.add(`#${hex}`);
    }
    expect([...offenders], 'colours outside Resurrect 64 (docs/PALETTE.md)').toEqual([]);
  });

  it('names its colours once, in :root', () => {
    // A hex anywhere but the role definitions is a colour with no name and no reason, and it is how
    // the drift happened the first time.
    const outside = css.replace(rootBlock, '');
    const strays = [...outside.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    // Alpha variants are allowed outside :root: a custom property cannot carry a variable alpha, and
    // a scrim genuinely needs the SAME colour at a different opacity.
    const opaque = strays.filter((hex) => hex.length !== 9);
    expect(opaque, 'use a --c-* role instead of a bare hex').toEqual([]);
  });
});

describe('the UI stylesheet uses only materials the renderer can produce', () => {
  it('has no blur and no antialiased curves', () => {
    // There is not one gaussian blur or antialiased radius anywhere in the world. A UI that has both
    // is not a stylistic variation, it is a different game's interface laid over this one.
    expect(css, 'backdrop-filter').not.toMatch(/backdrop-filter/);
    expect(css, 'blur()').not.toMatch(/blur\(/);
    expect(css, 'border-radius').not.toMatch(/border-radius/);
  });

  it('quantises motion', () => {
    // A smoothly eased transition moves an element BETWEEN pixel boundaries, which on an upscaled
    // pixel grid is visible as a sub-pixel shimmer. steps() lands it on them.
    const transitions = declarations.filter((d) => d.prop === 'transition');
    expect(transitions.length, 'there is at least one transition to check').toBeGreaterThan(0);
    for (const { value } of transitions) {
      const resolved = value.replace(/var\(--ease-steps\)/g, () => {
        const declared = /--ease-steps:\s*([^;]+);/.exec(rootBlock);
        return declared ? declared[1] : '';
      });
      expect(resolved, `transition "${value}" is not quantised`).toMatch(/steps\(/);
    }
  });

  it('gradients have hard stops', () => {
    // A banded gradient reads as dithered pixel art; a blended one reads as a web page. Hard stops
    // show up as a repeated colour at two different positions, or two positions that are equal.
    for (const { value } of declarations.filter((d) => /gradient/.test(d.value))) {
      const stops = [...value.matchAll(/(#[0-9a-fA-F]{3,8})\s+([\d.]+)%/g)].map((m) => m[1]);
      const repeated = stops.some((hex, i) => i > 0 && stops[i - 1] === hex);
      expect(repeated, `gradient "${value.slice(0, 60)}…" blends instead of banding`).toBe(true);
    }
  });
});
