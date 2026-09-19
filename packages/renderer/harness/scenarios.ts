import type { ContentPatch, PolishPatch, StylePatch, TemplateId } from '@jit/schema';

/**
 * The demo, as patches.
 *
 * Scenarios exist only in the harness. The renderer takes patches and paints; it
 * has no idea what a cookie is, and shipping demo content inside it would be the
 * first step back toward a lookup table.
 *
 * Every number here is one the orchestrator will compute from the typed recipe
 * rather than generate — these are fixtures standing in for that arithmetic, so
 * they are internally consistent: 18 cookies scaled to 30, then doubled to 60 by
 * the sugar recovery, leaving 30 extra to give away.
 */
export type Scenario = {
  /** What the presenter says, or does. */
  intent: string;
  beat: string;
  templateId: TemplateId;
  content: ContentPatch;
  style: StylePatch;
  /** Null where agent 4 would have nothing novel to add. */
  polish: PolishPatch | null;
};

const warmKitchen: StylePatch = {
  v: 1,
  theme: {
    palette: 'mono',
    fontPairing: 'editorial',
    density: 'normal',
    radius: 'soft',
    motif: 'none',
  },
};

export const SCENARIOS: Scenario[] = [
  {
    beat: '0:00',
    intent: 'I want to bake chocolate chip cookies tonight. Something easy.',
    templateId: 'choice_cards',
    content: {
      v: 1,
      slots: {
        'choice_cards.title': { kind: 'Heading', text: 'Chocolate chip, tonight' },
        'choice_cards.subtitle': {
          kind: 'Text',
          text: 'Three ways. Slide to trade time for impact.',
        },
        // The fader's FIRST meaning.
        'choice_cards.axis': {
          kind: 'Slider',
          label: 'Effort',
          min: 0,
          max: 4,
          step: 1,
          value: 1,
          minLabel: 'Quick',
          maxLabel: 'Impressive',
        },
        'choice_cards.option1': {
          kind: 'ListItem',
          title: 'Classic Chocolate Chip',
          detail: '35 min · 18 cookies',
          meta: '$6.40',
        },
        'choice_cards.option2': {
          kind: 'ListItem',
          title: 'Brown Butter',
          detail: '55 min · 18 cookies',
          meta: '$8.10',
        },
        'choice_cards.option3': {
          kind: 'ListItem',
          title: 'Double Chocolate',
          detail: '45 min · 20 cookies',
          meta: '$9.25',
        },
      },
    },
    style: warmKitchen,
    polish: null,
  },

  {
    beat: '0:30',
    intent: '(tap Classic Chocolate Chip) — the fader is remapped',
    templateId: 'recipe_overview',
    content: {
      v: 1,
      slots: {
        'recipe_overview.title': { kind: 'Heading', text: 'Classic Chocolate Chip' },
        'recipe_overview.yield': { kind: 'Text', text: 'Makes 30 cookies · about 35 minutes' },
        // The fader's SECOND meaning, thirty seconds later. Moment #1.
        'recipe_overview.batch': {
          kind: 'Slider',
          label: 'Batch size',
          min: 12,
          max: 30,
          step: 6,
          value: 30,
          unit: 'cookies',
        },
        'recipe_overview.ingredientsLabel': { kind: 'Label', text: 'Ingredients' },
        'recipe_overview.ingredient1': {
          kind: 'ListItem',
          title: 'Plain flour',
          meta: '3⅓ cups',
        },
        'recipe_overview.ingredient2': { kind: 'ListItem', title: 'Butter', meta: '1⅔ cups' },
        'recipe_overview.ingredient3': { kind: 'ListItem', title: 'Caster sugar', meta: '1¼ cups' },
        'recipe_overview.ingredient4': { kind: 'ListItem', title: 'Brown sugar', meta: '1¼ cups' },
        'recipe_overview.ingredient5': { kind: 'ListItem', title: 'Eggs', meta: '3' },
        'recipe_overview.ingredient6': { kind: 'ListItem', title: 'Chocolate chips', meta: '2 cups' },
        'recipe_overview.ingredient7': { kind: 'ListItem', title: 'Baking soda', meta: '1⅔ tsp' },
        // A shorter recipe sends null and the row collapses rather than
        // shimmering forever. Here: salt is folded into the dry step.
        'recipe_overview.ingredient8': null,
        'recipe_overview.start': { kind: 'Button', text: 'Start baking' },
      },
    },
    style: warmKitchen,
    polish: null,
  },

  {
    beat: '1:00',
    intent: '(tap Start baking) — planning interface gives way to doing',
    templateId: 'focus_step',
    content: {
      v: 1,
      slots: {
        'focus_step.progress': { kind: 'Label', text: 'Step 3 of 7' },
        'focus_step.instruction': { kind: 'Heading', text: 'Add dry ingredients' },
        'focus_step.detail1': { kind: 'ListItem', title: 'Plain flour', meta: '3⅓ cups' },
        'focus_step.detail2': { kind: 'ListItem', title: 'Baking soda', meta: '1⅔ tsp' },
        'focus_step.detail3': { kind: 'ListItem', title: 'Salt', meta: '¾ tsp' },
        'focus_step.prev': { kind: 'Button', text: 'Back' },
        'focus_step.next': { kind: 'Button', text: 'Skip' },
        'focus_step.done': { kind: 'Button', text: 'Done' },
      },
    },
    style: {
      v: 1,
      theme: { ...warmKitchen.theme, density: 'spacious' },
    },
    polish: null,
  },

  {
    beat: '1:40',
    intent: 'Wait, I accidentally added twice as much sugar.',
    templateId: 'recovery',
    content: {
      v: 1,
      slots: {
        'recovery.kind': { kind: 'Label', text: 'Correction' },
        'recovery.title': { kind: 'Heading', text: 'Too much sugar' },
        'recovery.diagnosis': {
          kind: 'Alert',
          text: 'You added about 2× the intended sugar — roughly 2½ cups instead of 1¼.',
        },
        'recovery.planLabel': { kind: 'Label', text: 'Best recovery' },
        'recovery.plan': {
          kind: 'Text',
          text: 'Double everything already in the bowl, and the rest of the recipe with it.',
        },
        // Computed from the typed recipe, never generated. 30 -> 60.
        'recovery.outcome': {
          kind: 'Metric',
          label: 'This will make',
          value: '60 cookies',
          delta: 'you planned for 30',
        },
        'recovery.secondary': { kind: 'Button', text: 'Start over' },
        'recovery.primary': { kind: 'Button', text: 'Fix recipe' },
      },
    },
    style: warmKitchen,
    polish: {
      v: 1,
      interpretedAs: 'something went wrong — make it legible, not alarming',
      tokens: {
        '--jit-bg': '#fdf8f3',
        '--jit-surface': '#ffffff',
        '--jit-border': '#e8d9c8',
        '--jit-accent': '#a8541f',
        '--jit-on-accent': '#ffffff',
        '--jit-fg': '#2b1d12',
        '--jit-muted': '#6d5744',
        '--jit-accent-soft': '#fbeee2',
      },
    },
  },

  {
    beat: '2:10',
    intent: '(fast-forward) — done, and deliberately actionless',
    templateId: 'summary_done',
    content: {
      v: 1,
      slots: {
        'summary_done.title': { kind: 'Heading', text: 'Cookies done' },
        'summary_done.result': {
          kind: 'Metric',
          label: 'Made',
          value: '60 cookies',
          delta: 'you planned for 30',
        },
        'summary_done.prompt': {
          kind: 'Text',
          text: 'That is 30 more than you need. What do you want to do with them?',
        },
      },
    },
    style: warmKitchen,
    polish: null,
  },

  {
    beat: '2:20',
    intent: 'Who could I give some to?',
    templateId: 'people_picker',
    content: {
      v: 1,
      slots: {
        'people_picker.title': { kind: 'Heading', text: 'Share the extras' },
        'people_picker.subtitle': { kind: 'Text', text: '30 extra cookies' },
        'people_picker.person1': { kind: 'ListItem', title: 'Alex', detail: 'Roommate' },
        'people_picker.person2': { kind: 'ListItem', title: 'Maya', detail: 'Friend' },
        'people_picker.person3': { kind: 'ListItem', title: 'Daniel', detail: 'Classmate' },
        'people_picker.confirm': { kind: 'Button', text: 'Write messages' },
      },
    },
    style: warmKitchen,
    polish: null,
  },

  {
    beat: '2:35',
    intent: '(tap Alex and Daniel, then Write messages) — out of the baking domain',
    templateId: 'message_drafts',
    content: {
      v: 1,
      slots: {
        'message_drafts.title': { kind: 'Heading', text: 'Two messages' },
        // The fader's THIRD meaning. Variants are pre-generated, so moving it
        // never waits on a model.
        'message_drafts.tone': {
          kind: 'Slider',
          label: 'Tone',
          min: 0,
          max: 4,
          step: 1,
          value: 1,
          minLabel: 'Casual',
          maxLabel: 'Polished',
        },
        'message_drafts.name1': { kind: 'Label', text: 'Alex · roommate' },
        'message_drafts.body1': {
          kind: 'Text',
          text: 'made way too many cookies 😭 want some?',
        },
        'message_drafts.name2': { kind: 'Label', text: 'Daniel · classmate' },
        'message_drafts.body2': {
          kind: 'Text',
          text: 'Hey — I ended up making a huge batch of cookies. I can bring some to class tomorrow if you’d like.',
        },
        'message_drafts.edit': { kind: 'Button', text: 'Edit' },
        'message_drafts.send': { kind: 'Button', text: 'Send both' },
      },
    },
    style: { v: 1, theme: { ...warmKitchen.theme, fontPairing: 'system' } },
    polish: null,
  },

  {
    beat: '3:00',
    intent: '(judge handoff) "how much did all this cost me?"',
    templateId: 'generic_answer',
    content: {
      v: 1,
      slots: {
        'generic_answer.title': { kind: 'Heading', text: 'About $12.80 on ingredients' },
        'generic_answer.body': {
          kind: 'Text',
          text: 'You doubled the batch part-way through, so the shopping list doubled with it. Here is where it went.',
        },
        'generic_answer.point1': {
          kind: 'ListItem',
          title: 'Butter',
          detail: '3⅓ cups',
          meta: '$5.20',
        },
        'generic_answer.point2': {
          kind: 'ListItem',
          title: 'Chocolate chips',
          detail: '4 cups',
          meta: '$4.60',
        },
        'generic_answer.point3': {
          kind: 'ListItem',
          title: 'Flour, sugar, eggs',
          detail: 'pantry staples',
          meta: '$3.00',
        },
        'generic_answer.action': { kind: 'Button', text: 'Add to shopping list' },
      },
    },
    style: warmKitchen,
    polish: null,
  },
];

/**
 * Deliberately unreadable. Fires the contrast gate so the rejection path is
 * demonstrable by hand rather than only in a test.
 */
export const UNREADABLE_POLISH: PolishPatch = {
  v: 1,
  interpretedAs: 'moody, low contrast, barely there',
  tokens: {
    '--jit-bg': '#3a3a3a',
    '--jit-surface': '#404040',
    '--jit-fg': '#4e4e4e',
    '--jit-muted': '#484848',
    '--jit-accent': '#555555',
    '--jit-on-accent': '#606060',
  },
};
