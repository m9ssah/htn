import type { ContentPatch, PolishPatch, StylePatch, TemplateId } from '@jit/schema';
import { SCENARIOS } from '../../../packages/renderer/harness/scenarios.js';

/**
 * The scripted demo, and the home tiles.
 *
 * A stand-in for the orchestrator so the shell is walkable before the server
 * exists. It reuses the harness scenarios rather than duplicating them, so
 * there is exactly one place the demo content lives.
 *
 * Nothing about the FLOW is scripted in the real system — this file is the
 * first thing deleted once `apps/server` is talking.
 */
export type Beat = {
  templateId: TemplateId;
  content: ContentPatch;
  style: StylePatch;
  polish: PolishPatch | null;
};

export const DEMO: Beat[] = SCENARIOS.map((s) => ({
  templateId: s.templateId,
  content: s.content,
  style: s.style,
  polish: s.polish,
}));

/**
 * The resting state's tiles. Not capabilities the user picks from — the device
 * has no apps. They are what it already knows about, which is what makes the
 * home feel like a system rather than a prompt box.
 */
export const HOME_TILES: { title: string; detail: string; accent?: boolean }[] = [
  { title: 'Tonight', detail: 'nothing planned', accent: true },
  { title: 'Kitchen', detail: '2 recipes saved' },
  { title: 'People', detail: '3 nearby' },
  { title: 'Spent', detail: '$41 this week' },
];
