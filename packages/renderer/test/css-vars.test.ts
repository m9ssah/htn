import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RENDERER_CSS_VARS } from '@jit/renderer';

// import.meta.url is an http URL under the happy-dom environment, so resolve
// from the vitest root instead.
const css = readFileSync(resolve(process.cwd(), 'packages/renderer/renderer.css'), 'utf8');

/** Every `var(--jit-*)` the stylesheet reads. */
const read = new Set([...css.matchAll(/var\(\s*(--jit-[a-z0-9-]+)/g)].map((m) => m[1]!));

/** Every `--jit-*` the stylesheet declares. Should be none — tokens owns them all. */
const declared = new Set([...css.matchAll(/^\s*(--jit-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]!));

describe('the renderer var manifest', () => {
  it('lists exactly the vars the stylesheet reads', () => {
    // Hand-maintained lists drift. This is what stops `RENDERER_CSS_VARS` from
    // quietly disagreeing with the CSS, which would let `resolve()` pass its
    // coverage test while the real surface reads an unset var.
    expect([...read].sort()).toEqual([...RENDERER_CSS_VARS].sort());
  });

  it('declares no --jit-* of its own — every one comes from a patch', () => {
    expect([...declared]).toEqual([]);
  });

  it('keeps its internal reservation vars namespaced away from the contract', () => {
    const internal = [...css.matchAll(/(--ph-[a-z0-9-]+)/g)].map((m) => m[1]!);
    expect(internal.length).toBeGreaterThan(0);
    for (const name of new Set(internal)) {
      expect(RENDERER_CSS_VARS).not.toContain(name);
    }
  });
});
