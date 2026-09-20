/**
 * The home tiles.
 *
 * This file used to hold the scripted demo too — a stand-in for the
 * orchestrator, built from the renderer's example scenarios. The server
 * drives the device now, so the beats are gone and with them the import of
 * `EXAMPLES`: the home screen had no reason to depend on the whole example
 * corpus loading, and anything that stopped that module evaluating took the
 * tiles down with it.
 *
 * What is left is seed data for the resting state, and says so.
 */

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
