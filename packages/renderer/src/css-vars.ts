import type { CssVar } from '@jit/schema';

/**
 * Every custom property `renderer.css` reads.
 *
 * `@jit/tokens`' `resolve()` must cover all of them — a var the renderer reads
 * and nothing writes resolves to the empty string and fails silently, which is
 * the exact shape of bug constraint 6 exists to prevent.
 *
 * Two tests hold this honest: one asserts `resolve()` covers this list, and one
 * asserts this list matches the vars actually referenced in the stylesheet, so
 * it cannot drift out of date by hand.
 */
export const RENDERER_CSS_VARS: readonly CssVar[] = [
  '--jit-bg',
  '--jit-surface',
  '--jit-border',
  '--jit-fg',
  '--jit-muted',
  '--jit-accent',
  '--jit-on-accent',
  '--jit-accent-soft',
  '--jit-input',
  '--jit-font-display',
  '--jit-font-body',
  '--jit-weight-display',
  '--jit-tracking-display',
  '--jit-scale',
  '--jit-gap',
  '--jit-pad',
  '--jit-density-f',
  '--jit-radius',
  '--jit-radius-sm',
  '--jit-motif',
  '--jit-maxw',
];
