import type { FontPairing } from '@jit/schema';

export type FontDefinition = {
  display: string;
  body: string;
  /** Display weight. Manrope and the system stacks carry different optical weight. */
  weightDisplay: string;
  /**
   * Display tracking. Carries as much of a pairing's voice as the family does:
   * `geometric` and `system` are the same face, and this is what separates them.
   */
  trackingDisplay: string;
};

/**
 * Manrope leads every stack that is not deliberately something else. It is
 * bundled (see fonts.css), so on the device it is what actually paints; the
 * native names behind it are a no-download fast path on a dev machine that
 * already has one, and `Segoe UI` is first among them because this design is
 * drawn to Segoe's metrics.
 */
const PRODUCT_SANS =
  '"Manrope",ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

/**
 * The bitmap display face.
 *
 * `OffBit` leads and is deliberately NOT bundled — it is a commercial face and
 * cannot ship in the repository. Pixelify Sans stands in behind it, so the
 * design is walkable today and licensed OffBit files take over the moment they
 * are added to tokens/assets with an @font-face. Nothing else has to change.
 */
const DISPLAY_PIXEL = '"OffBit","OffBit 101","Pixelify Sans",ui-monospace,monospace';

/**
 * Four pairings. `system` and `geometric` share the Manrope face and diverge on
 * weight and tracking instead of family: 200 tracked wide is the Metro display
 * voice, 300 tracked tight is the product voice, and the two are further apart
 * on screen than two different families at the same settings would be.
 */
export const FONTS: Record<FontPairing, FontDefinition> = {
  system: {
    display: PRODUCT_SANS,
    body: PRODUCT_SANS,
    weightDisplay: '300',
    trackingDisplay: '-0.02em',
  },
  /*
   * The bitmap register. Named `editorial` for the enum's sake — what it now
   * means is "give this surface a voice", and a pixel face at display size does
   * that where a serif was only decorating it.
   *
   * Tracked OUT, not in: bitmap letterforms carry their own sidebearings on the
   * pixel grid, and pulling them together closes the counters that make the
   * grid legible. This is the one pairing that tracks positive.
   */
  editorial: {
    display: DISPLAY_PIXEL,
    body: PRODUCT_SANS,
    weightDisplay: '400',
    trackingDisplay: '0.02em',
  },
  geometric: {
    display: PRODUCT_SANS,
    body: PRODUCT_SANS,
    weightDisplay: '200',
    trackingDisplay: '0.06em',
  },
  mono: {
    display: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace',
    body: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace',
    weightDisplay: '500',
    trackingDisplay: '-0.01em',
  },
};
