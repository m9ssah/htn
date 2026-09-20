import type { CssVar, PolishPatch, ThemeEnums, TokenSet } from '@jit/schema';
import { applyPolish, checkContrast, resolve } from '@jit/tokens';
import type { Node } from '../types.js';
import type { PolishBrief } from '../clients/polish.js';

/**
 * Agent 4's node: take what the designer invented, and refuse it if it is not
 * legible.
 *
 * The validation is here rather than in the client for the reason CLAUDE.md
 * gives for exporting `checkContrast` as a pure function — the real fix for a
 * failing patch is rejecting it and keeping the enum base, not patching
 * colours client-side after they have already painted.
 */

/**
 * Every axis agent 4 may write. A name outside this set is dropped rather
 * than passed through: `TokenSet` is a closed `Record<CssVar, string>`, so an
 * invented property would be written to the root as a var nothing reads —
 * failing silently, which is the class of bug constraint 5 exists to prevent.
 *
 * `--jit-maxw` and `--jit-density-f` are deliberately excluded. They are
 * LAYOUT, not looks: the composer sized every reservation against the panel
 * width it was given, and letting a styling pass change the extent after the
 * fact would move boxes the height budget already measured.
 */
const WRITABLE: readonly CssVar[] = [
  '--jit-bg', '--jit-surface', '--jit-border', '--jit-fg', '--jit-muted',
  '--jit-accent', '--jit-on-accent', '--jit-accent-soft', '--jit-input',
  '--jit-font-display', '--jit-font-body', '--jit-weight-display',
  '--jit-tracking-display', '--jit-scale', '--jit-gap', '--jit-pad',
  '--jit-radius', '--jit-radius-sm', '--jit-motif',
];

const WRITABLE_SET = new Set<string>(WRITABLE);

export type PolishInput = {
  brief: PolishBrief;
  /** The enum base this patch is layered over — what contrast is judged against. */
  theme: ThemeEnums;
  /** Whatever the designer returned. Unvalidated by construction. */
  raw: unknown;
};

export type PolishOutcome =
  | { ok: true; patch: PolishPatch }
  | { ok: false; reason: string; failures?: string[] };

/** Pulls the known axes out of an arbitrary object, dropping everything else. */
function readTokens(raw: unknown): { tokens: Partial<TokenSet>; dropped: string[] } {
  const source = (raw as { tokens?: unknown } | null)?.tokens;
  if (typeof source !== 'object' || source === null) return { tokens: {}, dropped: [] };

  const tokens: Partial<TokenSet> = {};
  const dropped: string[] = [];
  for (const [name, value] of Object.entries(source as Record<string, unknown>)) {
    // A number is accepted and stringified because `--jit-weight-display` and
    // `--jit-scale` are numeric axes a JSON-mode model returns as numbers far
    // more often than as strings; rejecting them would throw away a valid
    // answer over its encoding.
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text !== 'string' || text.trim() === '') {
      dropped.push(name);
      continue;
    }
    if (!WRITABLE_SET.has(name)) {
      dropped.push(name);
      continue;
    }
    tokens[name as CssVar] = text.trim();
  }
  return { tokens, dropped };
}

export const polish: Node<PolishInput, PolishOutcome> = {
  name: 'polish',
  async run(input) {
    const { tokens, dropped } = readTokens(input.raw);
    if (Object.keys(tokens).length === 0) {
      return { ok: false, reason: `no usable tokens${dropped.length > 0 ? ` (dropped ${dropped.join(', ')})` : ''}` };
    }

    /**
     * Checked as MERGED, never alone.
     *
     * A patch that sets only `--jit-fg` is legible or not depending on the
     * ground underneath it, which comes from the enum base. Validating the
     * partial patch in isolation would certify a foreground against a
     * background nobody ever put it on.
     *
     * `applyPolish` is the merge the device performs, so this checks exactly
     * what the device would paint — including its dark-ground floor, which
     * may already have dropped the colour half.
     */
    const base = resolve(input.theme);
    const merged = applyPolish(base, { v: 1, tokens, interpretedAs: '' });
    const report = checkContrast(merged);

    if (!report.pass) {
      const failures = report.checks
        .filter((check) => !check.pass)
        .map((check) => `${check.pair} ${check.ratio === null ? 'unreadable' : `${check.ratio.toFixed(2)}:1`} < ${check.required}:1`);
      // Rejected WHOLE, per the contrast policy: cherry-picking the passing
      // half would certify combinations that were never checked together.
      return { ok: false, reason: 'fails AA', failures };
    }

    const interpretedAs = (input.raw as { interpretedAs?: unknown } | null)?.interpretedAs;
    return {
      ok: true,
      patch: {
        v: 1,
        tokens,
        interpretedAs: typeof interpretedAs === 'string' && interpretedAs.trim() !== ''
          ? interpretedAs.trim()
          : `${input.brief.layout ?? input.brief.templateId} restyled`,
      },
    };
  },
};
