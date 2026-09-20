import type { FetchOutcome, Node } from '../types.js';

/**
 * Stage 2's fetch pass: run the candidate URLs, return what came back.
 *
 * **No model runs here.** The strong model produced the queries upstream and
 * Jev judges the results downstream — relevance, authority and conflict as
 * three separate questions, because docs/ARCHITECTURE.md measured that asking
 * "relevant *and* trustworthy" as one cost 0.50 precision. This node is the
 * "C: run the search / fetch — no model" box between them.
 *
 * Total, like `project` and `generate`: a candidate that fails is a *result*
 * saying so, not an exception. One unreachable URL must not lose the three
 * that answered.
 *
 * Fetches run concurrently — three rounds are meant to cost 1.4s + 3x250ms,
 * and serialising N candidates inside one round breaks that budget outright.
 */
export type ResearchInput = {
  urls: string[];
  /** Hard cap on candidates per round; extras are reported, never silently dropped. */
  maxUrls?: number;
};

export type ResearchFinding = { url: string; outcome: FetchOutcome };

export type ResearchResult = {
  findings: ResearchFinding[];
  warnings: string[];
};

const DEFAULT_MAX_URLS = 6;

export const research: Node<ResearchInput, ResearchResult> = {
  name: 'research',
  async run(input, ctx): Promise<ResearchResult> {
    const max = input.maxUrls ?? DEFAULT_MAX_URLS;
    const warnings: string[] = [];

    // De-duplicated: a query set that names the same page twice would
    // otherwise pay for it twice and let Jev count one source as two
    // agreeing ones.
    const unique = [...new Set(input.urls)];
    if (unique.length < input.urls.length) {
      warnings.push(`research: ${input.urls.length - unique.length} duplicate URL(s) dropped`);
    }

    const run = unique.slice(0, max);
    if (unique.length > run.length) {
      warnings.push(`research: ${unique.length - run.length} candidate(s) over the ${max}-URL cap were not fetched: ${unique.slice(max).join(', ')}`);
    }

    const findings = await Promise.all(
      run.map(async (url): Promise<ResearchFinding> => {
        try {
          return { url, outcome: await ctx.fetch.get(url, ctx.signal) };
        } catch (err) {
          // A client that throws instead of returning is still just one
          // failed candidate.
          return { url, outcome: { ok: false, reason: String(err) } };
        }
      }),
    );

    for (const finding of findings) {
      if (!finding.outcome.ok) warnings.push(`research: ${finding.url} — ${finding.outcome.reason}`);
    }

    return { findings, warnings };
  },
};
