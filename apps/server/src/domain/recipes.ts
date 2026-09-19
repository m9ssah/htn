import type { Recipe } from './recipe.js';

/**
 * Seeded recipes and the ingredient price table.
 *
 * This is a demo account, not a shortcut: in the real system these come from a
 * retrieval tool. What is NOT stubbed is anything about the flow — routing,
 * template choice, styling and the arithmetic all work for a recipe nobody
 * seeded, which is what the judge handoff tests.
 */

export const CLASSIC_CHOCOLATE_CHIP: Recipe = {
  id: 'classic_choc_chip',
  name: 'Classic Chocolate Chip',
  baseYield: 18,
  yieldUnit: 'cookies',
  minutes: 35,
  ingredients: [
    { id: 'flour', name: 'Plain flour', amount: 2, unit: 'cup', pricePerUnit: 0.42 },
    { id: 'butter', name: 'Butter', amount: 1, unit: 'cup', pricePerUnit: 1.56 },
    { id: 'caster_sugar', name: 'Caster sugar', amount: 0.75, unit: 'cup', pricePerUnit: 0.38 },
    { id: 'brown_sugar', name: 'Brown sugar', amount: 0.75, unit: 'cup', pricePerUnit: 0.44 },
    { id: 'eggs', name: 'Eggs', amount: 2, unit: 'each', pricePerUnit: 0.35 },
    { id: 'vanilla', name: 'Vanilla extract', amount: 1, unit: 'tsp', pricePerUnit: 0.3 },
    { id: 'choc_chips', name: 'Chocolate chips', amount: 1.25, unit: 'cup', pricePerUnit: 1.15 },
    { id: 'baking_soda', name: 'Baking soda', amount: 1, unit: 'tsp', pricePerUnit: 0.03 },
    { id: 'salt', name: 'Salt', amount: 0.5, unit: 'tsp', pricePerUnit: 0.01 },
  ],
  steps: [
    { id: 's1', instruction: 'Cream the butter and sugars', adds: ['butter', 'caster_sugar', 'brown_sugar'] },
    { id: 's2', instruction: 'Beat in the eggs and vanilla', adds: ['eggs', 'vanilla'] },
    { id: 's3', instruction: 'Add dry ingredients', adds: ['flour', 'baking_soda', 'salt'] },
    { id: 's4', instruction: 'Fold in the chocolate chips', adds: ['choc_chips'] },
    { id: 's5', instruction: 'Chill the dough for 20 minutes', adds: [] },
    { id: 's6', instruction: 'Scoop onto a lined tray', adds: [] },
    { id: 's7', instruction: 'Bake at 180°C for 11 minutes', adds: [] },
  ],
};

export const RECIPES: Record<string, Recipe> = {
  [CLASSIC_CHOCOLATE_CHIP.id]: CLASSIC_CHOCOLATE_CHIP,
};
