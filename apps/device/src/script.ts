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
 * The resting state's mosaic.
 *
 * Not capabilities the user picks from — the device has no apps. They are what
 * it already knows about, which is what makes the home feel like a system
 * rather than a prompt box.
 *
 * `w`/`h` are spans on the 6 x 3 grid and must total 18 cells, or the mosaic
 * leaves a hole. `tone` names one of the shell's four tile accents; omitting it
 * leaves the tile on the plum surface, and most of them should be left alone —
 * if everything is coloured, nothing is emphasised.
 */
export type Tile = {
  title: string;
  detail: string;
  w?: number;
  h?: number;
  tone?: 'magenta' | 'teal' | 'lime' | 'gold';
};

export const HOME_TILES: Tile[] = [
  // Row 1: the 2x2 opens, then 2 + 1 + 1 closes the six columns.
  { title: 'Tonight', detail: 'nothing planned', w: 2, h: 2, tone: 'magenta' },
  { title: 'Kitchen', detail: '2 recipes saved', w: 2 },
  { title: 'People', detail: '3 nearby', tone: 'teal' },
  { title: 'Spent', detail: '$41 this week' },
  // Row 2: the 2x2 still holds two columns, so 2 + 1 + 1 fills the rest.
  { title: 'Lights', detail: 'living room on', w: 2, tone: 'gold' },
  { title: 'Timer', detail: 'none running' },
  { title: 'Transit', detail: '7 min', tone: 'lime' },
  // Row 3: three doubles.
  { title: 'Notes', detail: '4 unread', w: 2 },
  { title: 'Weather', detail: '12°, clear', w: 2 },
  { title: 'Music', detail: 'paused', w: 2 },
];
