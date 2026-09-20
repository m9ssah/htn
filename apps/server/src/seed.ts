/**
 * Demo seed data — NOT derived from anything, and not disguised as if it
 * were. `choice_cards` and `people_picker` need something real to display
 * and nothing in `domain/` models a recipe catalogue or a contacts list
 * (CLAUDE.md constraint 6: "seeded contacts and a fixed price table are a
 * demo account, not a shortcut, and we say so plainly").
 *
 * Only `CLASSIC_CHOCOLATE_CHIP` (domain/recipes.ts) is wired up to actually
 * be followed end to end — the other two `CHOICE_OPTIONS` exist so the
 * picker is a real decision ("the user is deciding WHAT to do and has not
 * chosen yet") rather than one recipe framed three ways, which is not a
 * decision. `effort` gives `choice_cards.axis` a real quick <-> impressive
 * spread to scrub across.
 */

export type ChoiceOption = {
  id: string;
  title: string;
  blurb: string;
  minutes: number;
  /** Position on the quick (0) <-> impressive (2) axis `choice_cards.axis` scrubs. */
  effort: 0 | 1 | 2;
};

export const CHOICE_OPTIONS: ChoiceOption[] = [
  {
    id: 'no_bake_energy_bites',
    title: 'No-Bake Energy Bites',
    blurb: 'Five ingredients, no oven',
    minutes: 15,
    effort: 0,
  },
  {
    id: 'classic_choc_chip',
    title: 'Classic Chocolate Chip',
    blurb: 'The one this demo actually bakes',
    minutes: 35,
    effort: 1,
  },
  {
    id: 'three_layer_celebration_cake',
    title: 'Three-Layer Celebration Cake',
    blurb: 'Layers, filling, and a crumb coat',
    minutes: 90,
    effort: 2,
  },
];

export type Contact = { id: string; name: string };

export const CONTACTS: Contact[] = [
  { id: 'ari', name: 'Ari' },
  { id: 'blake', name: 'Blake' },
  { id: 'cass', name: 'Cass' },
];

/**
 * What is already in the kitchen, by ingredient id.
 *
 * Seed data, exactly like `CHOICE_OPTIONS` and `CONTACTS`: in a real system a
 * pantry comes from a tool, and there is no research or lookup step here — the
 * demo "just grabs" it (CLAUDE.md constraint 6, said plainly). It exists so
 * `grocery_added` is a real projection of the recipe against a real pantry
 * rather than the ingredient list relabelled.
 *
 * Nothing here is a number that appears on screen: the prices come from
 * `domain/recipes.ts` and the arithmetic from `estimateCost`.
 */
export const PANTRY_STOCKED: readonly string[] = ['flour', 'eggs', 'baking_soda', 'salt'];

/** The list the confirmation surface says the items were added to. */
export const GROCERY_LIST_NAME = 'Groceries';
/** The tracker the estimated cost is filed against. */
export const SPENDING_TRACKER_NAME = 'Food spending';
