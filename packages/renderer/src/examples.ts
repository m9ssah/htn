import type { ContentUpdateV2, PolishPatch, StructureUpdateV2, StylePatch, SurfaceSpec } from '@jit/schema';

export type SurfaceExample = {
  id: string;
  intent: string;
  structure: StructureUpdateV2;
  content: ContentUpdateV2;
  style: StylePatch;
  polish: PolishPatch | null;
};

type Leaf = {
  id: string;
  type: string;
  value: Record<string, string | number | boolean | number[]>;
  fixed?: Record<string, string | number | boolean>;
  action?: string;
};

const warmKitchen: StylePatch = { v: 1, theme: { palette: 'mono', fontPairing: 'editorial', density: 'normal', radius: 'soft', motif: 'none' } };

function blank(value: string | number | boolean | number[]): string | number | boolean | number[] {
  if (typeof value === 'string') return '';
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return value.map(() => 0);
}

function leaf(item: Leaf, lines = 1) {
  const content = Object.fromEntries(Object.entries(item.value).map(([key, value]) => [key, blank(value)]));
  const isDeterministic = (key: string, value: string | number | boolean | number[]) =>
    typeof value !== 'string' || (item.type === 'TextField' && key === 'value') || (item.type === 'Media' && key === 'src');
  return {
    element: {
      type: item.type,
      props: {
        id: item.id,
        pending: { $state: `/content/${item.id}/pending` },
        reserveLines: lines,
        ...Object.fromEntries(Object.entries(item.value).map(([key, value]) => [key, isDeterministic(key, value) ? value : { $state: `/content/${item.id}/${key}` }])),
        ...item.fixed,
      },
      ...(item.action ? { on: { [item.type === 'Slider' ? 'range' : item.type === 'Toggle' ? 'toggle' : item.type === 'TextField' ? 'text' : 'press']: { action: item.action } } } : {}),
    },
    content: { pending: true, ...content },
  };
}

function page(id: string, intent: string, tree: Record<string, { type: string; children?: string[]; props?: Record<string, unknown> }>, leaves: Array<[Leaf, number?]>, style = warmKitchen, polish: PolishPatch | null = null): SurfaceExample {
  const content: Record<string, Record<string, string | number | boolean | number[]>> = {};
  const elements: SurfaceSpec['elements'] = {};
  for (const [key, value] of Object.entries(tree)) elements[key] = { type: value.type as SurfaceSpec['elements'][string]['type'], props: (value.props ?? {}) as SurfaceSpec['elements'][string]['props'], ...(value.children ? { children: value.children } : {}) };
  for (const [item, lines] of leaves) {
    const result = leaf(item, lines);
    elements[item.id] = result.element as SurfaceSpec['elements'][string];
    content[item.id] = result.content;
  }
  const structure: StructureUpdateV2 = { v: 2, stage: 'structure', requestId: id, generationId: id, maxWidth: 640, status: 'complete', spec: { root: 'card', elements, state: { content } } };
  const values = Object.fromEntries(leaves.map(([item]) => [item.id, item.value]));
  return { id, intent, structure, content: { v: 2, stage: 'content', requestId: id, generationId: id, complete: true, values }, style, polish };
}

export const EXAMPLES: SurfaceExample[] = [
  page('choose-a-recipe', 'I want to bake chocolate chip cookies tonight. Something easy.', {
    card: { type: 'Card', children: ['stack'] }, stack: { type: 'Stack', children: ['title', 'subtitle', 'effort', 'divider', 'option-1', 'option-2', 'option-3'] }, divider: { type: 'Divider' },
  }, [
    [{ id: 'title', type: 'Heading', value: { text: 'Chocolate chip, tonight' }, fixed: { level: 1 } }, 1],
    [{ id: 'subtitle', type: 'Text', value: { text: 'Three ways. Slide to trade time for impact.' }, fixed: { tone: 'muted' } }, 1],
    [{ id: 'effort', type: 'Slider', value: { label: 'Effort', min: 0, max: 4, step: 1, value: 1, minLabel: 'Quick', maxLabel: 'Impressive' }, action: 'set_preference' }],
    [{ id: 'option-1', type: 'ListItem', value: { title: 'Classic Chocolate Chip', detail: '35 min · 18 cookies', meta: '$6.40' }, fixed: { interactive: true, hasDetail: true }, action: 'select_1' }],
    [{ id: 'option-2', type: 'ListItem', value: { title: 'Brown Butter', detail: '55 min · 18 cookies', meta: '$8.10' }, fixed: { interactive: true, hasDetail: true }, action: 'select_2' }],
    [{ id: 'option-3', type: 'ListItem', value: { title: 'Double Chocolate', detail: '45 min · 20 cookies', meta: '$9.25' }, fixed: { interactive: true, hasDetail: true }, action: 'select_3' }],
  ]),
  page('item-detail', 'Show the selected recipe and let the fader change quantity.', {
    card: { type: 'Card', children: ['stack'] }, stack: { type: 'Stack', children: ['title', 'subtitle', 'batch', 'divider', 'ingredients', 'flour', 'butter', 'sugar', 'eggs', 'chips', 'start'] }, divider: { type: 'Divider' },
  }, [
    [{ id: 'title', type: 'Heading', value: { text: 'Classic Chocolate Chip' }, fixed: { level: 1 } }, 1],
    [{ id: 'subtitle', type: 'Text', value: { text: 'Makes 30 cookies · about 35 minutes' }, fixed: { tone: 'muted' } }],
    [{ id: 'batch', type: 'Slider', value: { label: 'Batch size', min: 12, max: 30, step: 6, value: 30, unit: 'cookies' }, action: 'set_amount' }],
    [{ id: 'ingredients', type: 'Label', value: { text: 'Ingredients' } }],
    [{ id: 'flour', type: 'ListItem', value: { title: 'Plain flour', meta: '3⅓ cups' } }],
    [{ id: 'butter', type: 'ListItem', value: { title: 'Butter', meta: '1⅔ cups' } }],
    [{ id: 'sugar', type: 'ListItem', value: { title: 'Brown sugar', meta: '1¼ cups' } }],
    [{ id: 'eggs', type: 'ListItem', value: { title: 'Eggs', meta: '3' } }],
    [{ id: 'chips', type: 'ListItem', value: { title: 'Chocolate chips', meta: '2 cups' } }],
    [{ id: 'start', type: 'Button', value: { text: 'Start baking' }, fixed: { variant: 'primary' }, action: 'begin' }],
  ]),
  page('focus-step', 'Guide the next cooking step.', {
    card: { type: 'Card', children: ['stack'] }, stack: { type: 'Stack', children: ['progress', 'instruction', 'flour', 'soda', 'salt', 'buttons', 'done'] }, buttons: { type: 'ButtonGroup', children: ['back', 'skip'] },
  }, [
    [{ id: 'progress', type: 'Label', value: { text: 'Step 3 of 7' } }],
    [{ id: 'instruction', type: 'Heading', value: { text: 'Add dry ingredients' }, fixed: { level: 1 } }, 2],
    [{ id: 'flour', type: 'ListItem', value: { title: 'Plain flour', meta: '3⅓ cups' } }],
    [{ id: 'soda', type: 'ListItem', value: { title: 'Baking soda', meta: '1⅔ tsp' } }],
    [{ id: 'salt', type: 'ListItem', value: { title: 'Salt', meta: '¾ tsp' } }],
    [{ id: 'back', type: 'Button', value: { text: 'Back' }, fixed: { variant: 'ghost' }, action: 'prev_step' }],
    [{ id: 'skip', type: 'Button', value: { text: 'Skip' }, fixed: { variant: 'ghost' }, action: 'next_step' }],
    [{ id: 'done', type: 'Button', value: { text: 'Done' }, fixed: { variant: 'primary' }, action: 'step_done' }],
  ], { v: 1, theme: { ...warmKitchen.theme, density: 'spacious' } }),
  page('recovery', 'Recover from adding too much sugar.', {
    card: { type: 'Card', children: ['stack'] }, stack: { type: 'Stack', children: ['kind', 'title', 'diagnosis', 'plan-label', 'plan', 'outcome', 'buttons'] }, buttons: { type: 'ButtonGroup', children: ['restart', 'fix'] },
  }, [
    [{ id: 'kind', type: 'Label', value: { text: 'Correction' } }],
    [{ id: 'title', type: 'Heading', value: { text: 'Too much sugar' }, fixed: { level: 1 } }],
    [{ id: 'diagnosis', type: 'Alert', value: { text: 'You added about 2× the intended sugar — roughly 2½ cups instead of 1¼.' } }, 2],
    [{ id: 'plan-label', type: 'Label', value: { text: 'Best recovery' } }],
    [{ id: 'plan', type: 'Text', value: { text: 'Double everything already in the bowl, and the rest of the recipe with it.' } }, 2],
    [{ id: 'outcome', type: 'Metric', value: { label: 'This will make', value: '60 cookies', delta: 'you planned for 30' } }],
    [{ id: 'restart', type: 'Button', value: { text: 'Start over' }, fixed: { variant: 'secondary' }, action: 'start_over' }],
    [{ id: 'fix', type: 'Button', value: { text: 'Fix recipe' }, fixed: { variant: 'primary' }, action: 'apply_fix' }],
  ], warmKitchen, { v: 1, interpretedAs: 'something went wrong — make it legible, not alarming', tokens: { '--jit-bg': '#fdf8f3', '--jit-surface': '#ffffff', '--jit-border': '#e8d9c8', '--jit-accent': '#a8541f', '--jit-on-accent': '#ffffff', '--jit-fg': '#2b1d12', '--jit-muted': '#6d5744', '--jit-accent-soft': '#fbeee2' } }),
  page('summary-done', 'Summarize the completed task.', {
    card: { type: 'Card', children: ['stack'] }, stack: { type: 'Stack', children: ['title', 'result', 'prompt'] },
  }, [
    [{ id: 'title', type: 'Heading', value: { text: 'Cookies done' }, fixed: { level: 1 } }],
    [{ id: 'result', type: 'Metric', value: { label: 'Made', value: '60 cookies', delta: 'you planned for 30' } }],
    [{ id: 'prompt', type: 'Text', value: { text: 'That is 30 more than you need. What do you want to do with them?' } }, 2],
  ]),
  page('people-picker', 'Help choose people to share cookies with.', {
    card: { type: 'Card', children: ['stack'] }, stack: { type: 'Stack', children: ['title', 'subtitle', 'alex', 'maya', 'daniel', 'confirm'] },
  }, [
    [{ id: 'title', type: 'Heading', value: { text: 'Share the extras' }, fixed: { level: 1 } }],
    [{ id: 'subtitle', type: 'Text', value: { text: '30 extra cookies' }, fixed: { tone: 'muted' } }],
    [{ id: 'alex', type: 'ListItem', value: { title: 'Alex', detail: 'Roommate' }, fixed: { interactive: true, hasDetail: true }, action: 'choose_alex' }],
    [{ id: 'maya', type: 'ListItem', value: { title: 'Maya', detail: 'Friend' }, fixed: { interactive: true, hasDetail: true }, action: 'choose_maya' }],
    [{ id: 'daniel', type: 'ListItem', value: { title: 'Daniel', detail: 'Classmate' }, fixed: { interactive: true, hasDetail: true }, action: 'choose_daniel' }],
    [{ id: 'confirm', type: 'Button', value: { text: 'Write messages' }, fixed: { variant: 'primary' }, action: 'write_messages' }],
  ]),
  page('message-drafts', 'Draft messages for selected people.', {
    card: { type: 'Card', children: ['stack'] }, stack: { type: 'Stack', children: ['title', 'tone', 'alex', 'body-a', 'daniel', 'body-d', 'buttons'] }, buttons: { type: 'ButtonGroup', children: ['edit', 'send'] },
  }, [
    [{ id: 'title', type: 'Heading', value: { text: 'Two messages' }, fixed: { level: 1 } }],
    [{ id: 'tone', type: 'Slider', value: { label: 'Tone', min: 0, max: 4, step: 1, value: 1, minLabel: 'Casual', maxLabel: 'Polished' }, action: 'set_tone' }],
    [{ id: 'alex', type: 'Label', value: { text: 'Alex · roommate' } }],
    [{ id: 'body-a', type: 'Text', value: { text: 'made way too many cookies 😭 want some?' } }],
    [{ id: 'daniel', type: 'Label', value: { text: 'Daniel · classmate' } }],
    [{ id: 'body-d', type: 'Text', value: { text: 'Hey — I ended up making a huge batch of cookies. I can bring some to class tomorrow if you’d like.' } }, 2],
    [{ id: 'edit', type: 'Button', value: { text: 'Edit' }, fixed: { variant: 'secondary' }, action: 'edit' }],
    [{ id: 'send', type: 'Button', value: { text: 'Send both' }, fixed: { variant: 'primary' }, action: 'send' }],
  ], { v: 1, theme: { ...warmKitchen.theme, fontPairing: 'system' } }),
  page('generic-answer', 'How much did all this cost me?', {
    card: { type: 'Card', children: ['stack'] }, stack: { type: 'Stack', children: ['title', 'body', 'butter', 'chips', 'staples', 'add'] },
  }, [
    [{ id: 'title', type: 'Heading', value: { text: 'About $12.80 on ingredients' }, fixed: { level: 1 } }],
    [{ id: 'body', type: 'Text', value: { text: 'You doubled the batch part-way through, so the shopping list doubled with it. Here is where it went.' } }, 2],
    [{ id: 'butter', type: 'ListItem', value: { title: 'Butter', detail: '3⅓ cups', meta: '$5.20' }, fixed: { hasDetail: true } }],
    [{ id: 'chips', type: 'ListItem', value: { title: 'Chocolate chips', detail: '4 cups', meta: '$4.60' }, fixed: { hasDetail: true } }],
    [{ id: 'staples', type: 'ListItem', value: { title: 'Flour, sugar, eggs', detail: 'pantry staples', meta: '$3.00' }, fixed: { hasDetail: true } }],
    [{ id: 'add', type: 'Button', value: { text: 'Add to shopping list' }, fixed: { variant: 'primary' }, action: 'add_to_list' }],
  ]),
];

/** A ninth, cross-domain fixture proves new pages are authored as a Spec, not a template. */
export const STUDY_SESSION_EXAMPLE = page('study-session-planner', 'Plan a focused study session for tomorrow.', {
  card: { type: 'Card', children: ['stack'] }, stack: { type: 'Stack', children: ['badge', 'title', 'topic', 'focus', 'breaks', 'duration', 'start'] },
}, [
  [{ id: 'badge', type: 'Badge', value: { text: 'Tomorrow' } }],
  [{ id: 'title', type: 'Heading', value: { text: 'Plan a study session' }, fixed: { level: 1 } }],
  [{ id: 'topic', type: 'TextField', value: { label: 'Focus topic', placeholder: 'Linear algebra', value: '' }, action: 'edit_topic' }],
  [{ id: 'focus', type: 'Toggle', value: { label: 'Silence notifications', on: true }, action: 'toggle_focus' }],
  [{ id: 'breaks', type: 'Text', value: { text: 'A short break is scheduled halfway through.' }, fixed: { tone: 'muted' } }],
  [{ id: 'duration', type: 'Slider', value: { label: 'Duration', min: 25, max: 120, step: 5, value: 50, unit: 'min' }, action: 'set_duration' }],
  [{ id: 'start', type: 'Button', value: { text: 'Start plan' }, fixed: { variant: 'primary' }, action: 'start_plan' }],
]);

/** The testbench gallery is also a real json-render Spec; no primitive bypass exists. */
export const PRIMITIVE_GALLERY_EXAMPLE = page('primitive-gallery', 'Inspect every design-system primitive.', {
  card: { type: 'Card', children: ['stack'] },
  stack: { type: 'Stack', children: ['label', 'heading', 'text', 'badge', 'grid', 'divider', 'rule', 'alert', 'field', 'toggle', 'slider', 'buttons'] },
  grid: { type: 'Grid', children: ['metric', 'media', 'list', 'bars', 'progress'] },
  divider: { type: 'Divider' },
  buttons: { type: 'ButtonGroup', children: ['primary', 'secondary', 'ghost'] },
}, [
  [{ id: 'label', type: 'Label', value: { text: 'Primitive gallery' } }],
  [{ id: 'heading', type: 'Heading', value: { text: 'Display heading' }, fixed: { level: 1 } }],
  [{ id: 'text', type: 'Text', value: { text: 'Body copy stays compact, calm, and readable at arm’s length.' } }],
  [{ id: 'badge', type: 'Badge', value: { text: 'Ready' } }],
  [{ id: 'metric', type: 'Metric', value: { label: 'Batch size', value: '30 cookies', delta: '+12 from original' } }],
  [{ id: 'media', type: 'Media', value: { caption: 'Media · 16:9' } }],
  [{ id: 'list', type: 'ListItem', value: { title: 'Chocolate chips', detail: 'Pantry', meta: '2 cups' }, fixed: { hasDetail: true } }],
  [{ id: 'bars', type: 'Bars', value: { values: [34, 68, 48, 88, 62] } }],
  [{ id: 'progress', type: 'Progress', value: { pct: 64 } }],
  [{ id: 'rule', type: 'Rule', value: { left: 'Estimated total', right: '$12.80' } }],
  [{ id: 'alert', type: 'Alert', value: { text: 'This is an inline alert with a recommended next step.' } }],
  [{ id: 'field', type: 'TextField', value: { label: 'Message', placeholder: 'Type a note…', value: '' }, action: 'edit' }],
  [{ id: 'toggle', type: 'Toggle', value: { label: 'Include substitutions', on: true }, action: 'toggle' }],
  [{ id: 'slider', type: 'Slider', value: { label: 'Intensity', min: 0, max: 4, step: 1, value: 2, minLabel: 'Soft', maxLabel: 'Bold' }, action: 'intensity' }],
  [{ id: 'primary', type: 'Button', value: { text: 'Primary action' }, fixed: { variant: 'primary' }, action: 'choose' }],
  [{ id: 'secondary', type: 'Button', value: { text: 'Secondary' }, fixed: { variant: 'secondary' }, action: 'back' }],
  [{ id: 'ghost', type: 'Button', value: { text: 'Ghost action' }, fixed: { variant: 'ghost' }, action: 'edit' }],
], { v: 1, theme: { palette: 'slate', fontPairing: 'system', density: 'compact', radius: 'soft', motif: 'none' } });
