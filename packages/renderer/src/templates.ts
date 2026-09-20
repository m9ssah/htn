import type { LeafComponent, SlotId, StructuralComponent, Surface, TemplateId } from '@jit/schema';
import type { NodeProps } from './vocab.js';

/**
 * The eight skeleton templates.
 *
 * These live here and nowhere else. Agent 2 selects an ID; it never emits a
 * tree. They are named for the *phase of a task* they serve, not for a domain —
 * `choice_cards` picks a recipe today and a train tomorrow, and the renderer
 * never learns which.
 *
 * Widths target the device's 4" 800x480 touchscreen, not a desktop.
 */

export type StructuralNode = {
  type: Exclude<StructuralComponent, 'Divider'>;
  children: TemplateNode[];
};

export type DividerNode = { type: 'Divider' };

export type LeafNode = {
  type: LeafComponent;
  slot: SlotId;
  props?: NodeProps;
  /**
   * Lines of text this slot reserves. The reservation is permanent, not
   * shimmer-only: the box is sized from the component's own type metrics before
   * content exists and keeps that minimum afterwards, so content landing can
   * never pull the layout upward.
   */
  lines?: number;
  /**
   * Required on Button / Toggle / TextField / Slider. Optional on ListItem,
   * which is a control only when a template says so.
   */
  action?: string;
  /**
   * ListItem only: this row carries a secondary line. Declared here rather than
   * inferred from content for the same reason `lines` is — the box has to be
   * reserved before the content that fills it exists.
   */
  detail?: boolean;
};

export type TemplateNode = StructuralNode | DividerNode | LeafNode;

export type Template = {
  id: TemplateId;
  maxWidth: number;
  /**
   * The grounds this template actually paints text on, which narrows the
   * required contrast pairs.
   */
  surfaces: Surface[];
  tree: TemplateNode;
};

export const isLeaf = (node: TemplateNode): node is LeafNode => 'slot' in node;

const card = (...children: TemplateNode[]): StructuralNode => ({
  type: 'Card',
  children: [{ type: 'Stack', children }],
});

/** A passive single-line row: a quantity, a step detail. */
const row = (slot: SlotId): LeafNode => ({ type: 'ListItem', slot });

/** A passive two-line row. */
const row2 = (slot: SlotId): LeafNode => ({ type: 'ListItem', slot, detail: true });

/** A selectable two-line row: an option, a person. */
const pick = (slot: SlotId, action: string): LeafNode => ({
  type: 'ListItem',
  slot,
  action,
  detail: true,
});

export const TEMPLATES: Record<TemplateId, Template> = {
  /**
   * 0:00–0:30. Decide between generated options; the slider scrubs the axis
   * they vary along. Three options, because three presses plus nothing else
   * leaves a button spare and the fader is a separate control.
   */
  choice_cards: {
    id: 'choice_cards',
    maxWidth: 640,
    surfaces: ['surface'],
    tree: card(
      { type: 'Heading', slot: 'choice_cards.title', props: { level: 1 }, lines: 1 },
      { type: 'Text', slot: 'choice_cards.subtitle', props: { tone: 'muted' }, lines: 1 },
      { type: 'Slider', slot: 'choice_cards.axis', action: 'set_preference' },
      { type: 'Divider' },
      pick('choice_cards.option1', 'select_1'),
      pick('choice_cards.option2', 'select_2'),
      pick('choice_cards.option3', 'select_3'),
    ),
  },

  /**
   * 0:30–1:00. The same fader, thirty seconds later, now meaning batch size.
   * Eight ingredient slots; a shorter recipe sends `null` for the rest and they
   * collapse rather than shimmering forever.
   */
  item_detail: {
    id: 'item_detail',
    maxWidth: 640,
    surfaces: ['surface'],
    tree: card(
      { type: 'Heading', slot: 'item_detail.title', props: { level: 1 }, lines: 1 },
      { type: 'Text', slot: 'item_detail.subtitle', props: { tone: 'muted' }, lines: 1 },
      { type: 'Slider', slot: 'item_detail.axis', action: 'set_amount' },
      { type: 'Divider' },
      { type: 'Label', slot: 'item_detail.linesLabel' },
      row('item_detail.line1'),
      row('item_detail.line2'),
      row('item_detail.line3'),
      row('item_detail.line4'),
      row('item_detail.line5'),
      row('item_detail.line6'),
      row('item_detail.line7'),
      row('item_detail.line8'),
      {
        type: 'Button',
        slot: 'item_detail.primary',
        props: { variant: 'primary' },
        action: 'begin',
      },
    ),
  },

  /**
   * 1:00–1:40. Sparse on purpose — while your hands are busy you need the
   * current instruction and nothing else. prev/next exist as real buttons so
   * the encoder has something to map to and touch users have a way through.
   */
  focus_step: {
    id: 'focus_step',
    maxWidth: 560,
    surfaces: ['surface'],
    tree: card(
      { type: 'Label', slot: 'focus_step.progress' },
      { type: 'Heading', slot: 'focus_step.instruction', props: { level: 1 }, lines: 2 },
      row('focus_step.detail1'),
      row('focus_step.detail2'),
      row('focus_step.detail3'),
      {
        type: 'ButtonGroup',
        children: [
          {
            type: 'Button',
            slot: 'focus_step.prev',
            props: { variant: 'ghost' },
            action: 'prev_step',
          },
          {
            type: 'Button',
            slot: 'focus_step.next',
            props: { variant: 'ghost' },
            action: 'next_step',
          },
        ],
      },
      {
        type: 'Button',
        slot: 'focus_step.done',
        props: { variant: 'primary' },
        action: 'step_done',
      },
    ),
  },

  /**
   * 1:40–2:10. The reasoning moment. Every number in `outcome` is computed in
   * TypeScript from the task state — the model classified the deviation, it did
   * not do the arithmetic.
   */
  recovery: {
    id: 'recovery',
    maxWidth: 560,
    // 'accent-soft' is required, not just 'surface': the Alert below paints on
    // --jit-accent-soft, a ground 'surface' does not cover.
    surfaces: ['surface', 'accent-soft'],
    tree: card(
      { type: 'Label', slot: 'recovery.kind' },
      { type: 'Heading', slot: 'recovery.title', props: { level: 1 }, lines: 1 },
      { type: 'Alert', slot: 'recovery.diagnosis', lines: 2 },
      { type: 'Label', slot: 'recovery.planLabel' },
      { type: 'Text', slot: 'recovery.plan', lines: 2 },
      { type: 'Metric', slot: 'recovery.outcome' },
      {
        type: 'ButtonGroup',
        children: [
          {
            type: 'Button',
            slot: 'recovery.secondary',
            props: { variant: 'secondary' },
            action: 'start_over',
          },
          {
            type: 'Button',
            slot: 'recovery.primary',
            props: { variant: 'primary' },
            action: 'apply_fix',
          },
        ],
      },
    ),
  },

  /**
   * 2:10–2:20. Deliberately actionless. The script calls for an open prompt
   * rather than a predefined button row, so the LEDs going dark here is correct
   * and meaningful: the device is waiting for you, not offering a menu.
   */
  summary_done: {
    id: 'summary_done',
    maxWidth: 520,
    surfaces: ['surface'],
    tree: card(
      { type: 'Heading', slot: 'summary_done.title', props: { level: 1 }, lines: 1 },
      { type: 'Metric', slot: 'summary_done.result' },
      { type: 'Text', slot: 'summary_done.prompt', props: { tone: 'muted' }, lines: 2 },
    ),
  },

  /** 2:20–2:50. Three people plus confirm is exactly the four buttons. */
  people_picker: {
    id: 'people_picker',
    maxWidth: 560,
    surfaces: ['surface'],
    tree: card(
      { type: 'Heading', slot: 'people_picker.title', props: { level: 1 }, lines: 1 },
      { type: 'Text', slot: 'people_picker.subtitle', props: { tone: 'muted' }, lines: 1 },
      { type: 'Divider' },
      pick('people_picker.person1', 'pick_1'),
      pick('people_picker.person2', 'pick_2'),
      pick('people_picker.person3', 'pick_3'),
      {
        type: 'Button',
        slot: 'people_picker.confirm',
        props: { variant: 'primary' },
        action: 'write_messages',
      },
    ),
  },

  /**
   * 2:20–2:50. The task is not baking any more, so neither is the interface.
   * The fader's third meaning: tone. Variants are pre-generated server-side, so
   * moving it never waits on a model.
   */
  message_drafts: {
    id: 'message_drafts',
    maxWidth: 640,
    surfaces: ['surface'],
    tree: card(
      { type: 'Heading', slot: 'message_drafts.title', props: { level: 2 }, lines: 1 },
      { type: 'Slider', slot: 'message_drafts.tone', action: 'set_tone' },
      { type: 'Divider' },
      { type: 'Label', slot: 'message_drafts.name1' },
      { type: 'Text', slot: 'message_drafts.body1', lines: 3 },
      { type: 'Label', slot: 'message_drafts.name2' },
      { type: 'Text', slot: 'message_drafts.body2', lines: 3 },
      {
        type: 'ButtonGroup',
        children: [
          {
            type: 'Button',
            slot: 'message_drafts.edit',
            props: { variant: 'secondary' },
            action: 'edit',
          },
          {
            type: 'Button',
            slot: 'message_drafts.send',
            props: { variant: 'primary' },
            action: 'send',
          },
        ],
      },
    ),
  },

  /**
   * The judge handoff. Not a safety net — this is what answers a question
   * nobody scripted, which is the only thing in the demo that proves the
   * surfaces are generated rather than routed to. The three points collapse
   * when unused.
   */
  generic_answer: {
    id: 'generic_answer',
    maxWidth: 600,
    surfaces: ['bg'],
    tree: {
      type: 'Stack',
      children: [
        { type: 'Heading', slot: 'generic_answer.title', props: { level: 1 }, lines: 2 },
        { type: 'Text', slot: 'generic_answer.body', lines: 3 },
        row2('generic_answer.point1'),
        row2('generic_answer.point2'),
        row2('generic_answer.point3'),
        {
          type: 'Button',
          slot: 'generic_answer.action',
          props: { variant: 'primary' },
          action: 'primary_action',
        },
      ],
    },
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];
