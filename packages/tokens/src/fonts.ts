import type { FontPairing } from '@jit/schema';

export type FontDefinition = {
  display: string;
  body: string;
  /** Display weight. Jost and the system stacks carry different optical weight. */
  weightDisplay: string;
};

const SYSTEM_SANS =
  'ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

/**
 * Four pairings. `geometric` leads with the bundled Jost face (see fonts.css) and
 * lists native equivalents behind it as a no-download fast path on machines that
 * already have one.
 */
export const FONTS: Record<FontPairing, FontDefinition> = {
  system: {
    display: SYSTEM_SANS,
    body: SYSTEM_SANS,
    weightDisplay: '700',
  },
  editorial: {
    display: 'Georgia,"Iowan Old Style","Times New Roman",serif',
    body: SYSTEM_SANS,
    weightDisplay: '600',
  },
  geometric: {
    display: '"Jost","Avenir Next",Futura,"Century Gothic",sans-serif',
    body: '"Jost","Avenir Next",Futura,"Century Gothic",sans-serif',
    weightDisplay: '600',
  },
  mono: {
    display: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace',
    body: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace',
    weightDisplay: '700',
  },
};
