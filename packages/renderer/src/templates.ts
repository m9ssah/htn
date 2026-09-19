import type { LeafComponent, SlotId, StructuralComponent, Surface, TemplateId } from '@jit/schema';
import type { NodeProps } from './vocab.js';

/**
 * The eight skeleton templates.
 *
 * These live here and nowhere else. Agent 2 selects an ID; it never emits a
 * tree. A model that could generate structure could generate structure we have
 * no CSS for.
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
  /** Required on every interactive leaf. The hardware layer maps these. */
  action?: string;
};

export type TemplateNode = StructuralNode | DividerNode | LeafNode;

export type Template = {
  id: TemplateId;
  maxWidth: number;
  /**
   * The grounds this template actually paints text on, which narrows the
   * required contrast pairs. Only `reader` has no Card.
   */
  surfaces: Surface[];
  tree: TemplateNode;
};

export const isLeaf = (node: TemplateNode): node is LeafNode => 'slot' in node;

const card = (...children: TemplateNode[]): StructuralNode => ({
  type: 'Card',
  children: [{ type: 'Stack', children }],
});

export const TEMPLATES: Record<TemplateId, Template> = {
  /** One action, stripped to its controls. */
  task_focus: {
    id: 'task_focus',
    maxWidth: 360,
    surfaces: ['surface'],
    tree: card(
      { type: 'Badge', slot: 'task_focus.badge' },
      { type: 'Heading', slot: 'task_focus.title', props: { level: 1 }, lines: 1 },
      { type: 'Media', slot: 'task_focus.preview' },
      { type: 'Rule', slot: 'task_focus.range' },
      {
        type: 'ButtonGroup',
        children: [
          {
            type: 'Button',
            slot: 'task_focus.markIn',
            props: { variant: 'secondary' },
            action: 'mark_in',
          },
          {
            type: 'Button',
            slot: 'task_focus.markOut',
            props: { variant: 'secondary' },
            action: 'mark_out',
          },
        ],
      },
      {
        type: 'Button',
        slot: 'task_focus.confirm',
        props: { variant: 'primary' },
        action: 'confirm',
      },
    ),
  },

  /** One record, shown whole. */
  ticket_detail: {
    id: 'ticket_detail',
    maxWidth: 380,
    surfaces: ['surface'],
    tree: card(
      { type: 'Label', slot: 'ticket_detail.operator' },
      { type: 'Heading', slot: 'ticket_detail.title', props: { level: 1 }, lines: 1 },
      { type: 'Text', slot: 'ticket_detail.summary', props: { tone: 'muted' }, lines: 1 },
      { type: 'Divider' },
      {
        type: 'Row',
        children: [
          { type: 'Metric', slot: 'ticket_detail.origin' },
          { type: 'Metric', slot: 'ticket_detail.destination' },
        ],
      },
      { type: 'Divider' },
      { type: 'Rule', slot: 'ticket_detail.seat' },
      {
        type: 'Button',
        slot: 'ticket_detail.view',
        props: { variant: 'primary' },
        action: 'view_ticket',
      },
    ),
  },

  auth_form: {
    id: 'auth_form',
    maxWidth: 360,
    surfaces: ['surface'],
    tree: card(
      { type: 'Heading', slot: 'auth_form.title', props: { level: 2 }, lines: 1 },
      { type: 'Text', slot: 'auth_form.subtitle', props: { tone: 'muted' }, lines: 1 },
      { type: 'TextField', slot: 'auth_form.email', action: 'enter_email' },
      { type: 'TextField', slot: 'auth_form.password', action: 'enter_password' },
      { type: 'Button', slot: 'auth_form.submit', props: { variant: 'primary' }, action: 'submit' },
      { type: 'Button', slot: 'auth_form.recover', props: { variant: 'ghost' }, action: 'recover' },
    ),
  },

  /** The densest template — the one the device has to fight hardest to fit. */
  dashboard: {
    id: 'dashboard',
    maxWidth: 470,
    surfaces: ['surface'],
    tree: card(
      { type: 'Heading', slot: 'dashboard.title', props: { level: 2 }, lines: 1 },
      { type: 'Text', slot: 'dashboard.period', props: { tone: 'muted' }, lines: 1 },
      { type: 'Metric', slot: 'dashboard.primaryMetric' },
      {
        type: 'Row',
        children: [
          { type: 'Metric', slot: 'dashboard.secondaryMetric' },
          { type: 'Metric', slot: 'dashboard.tertiaryMetric' },
        ],
      },
      { type: 'Label', slot: 'dashboard.chartLabel' },
      { type: 'Bars', slot: 'dashboard.chart' },
      { type: 'Label', slot: 'dashboard.listLabel' },
      { type: 'ListItem', slot: 'dashboard.item1' },
      { type: 'ListItem', slot: 'dashboard.item2' },
      { type: 'ListItem', slot: 'dashboard.item3' },
    ),
  },

  /** The only template with no Card and no controls — it paints straight on bg. */
  reader: {
    id: 'reader',
    maxWidth: 440,
    surfaces: ['bg'],
    tree: {
      type: 'Stack',
      children: [
        { type: 'Heading', slot: 'reader.title', props: { level: 1 }, lines: 2 },
        { type: 'Text', slot: 'reader.byline', props: { tone: 'muted' }, lines: 1 },
        { type: 'Divider' },
        { type: 'Text', slot: 'reader.para1', lines: 3 },
        { type: 'Text', slot: 'reader.para2', lines: 3 },
        { type: 'Text', slot: 'reader.para3', lines: 2 },
      ],
    },
  },

  /** Four toggles — one per physical button. The form factor's best case. */
  settings_panel: {
    id: 'settings_panel',
    maxWidth: 380,
    surfaces: ['surface'],
    tree: card(
      { type: 'Heading', slot: 'settings_panel.title', props: { level: 2 }, lines: 1 },
      { type: 'Toggle', slot: 'settings_panel.option1', action: 'toggle_1' },
      { type: 'Divider' },
      { type: 'Toggle', slot: 'settings_panel.option2', action: 'toggle_2' },
      { type: 'Divider' },
      { type: 'Toggle', slot: 'settings_panel.option3', action: 'toggle_3' },
      { type: 'Divider' },
      { type: 'Toggle', slot: 'settings_panel.option4', action: 'toggle_4' },
    ),
  },

  confirm_action: {
    id: 'confirm_action',
    maxWidth: 340,
    surfaces: ['surface'],
    tree: card(
      { type: 'Heading', slot: 'confirm_action.title', props: { level: 2 }, lines: 1 },
      { type: 'Alert', slot: 'confirm_action.warning', lines: 3 },
      {
        type: 'ButtonGroup',
        children: [
          {
            type: 'Button',
            slot: 'confirm_action.cancel',
            props: { variant: 'secondary' },
            action: 'cancel',
          },
          {
            type: 'Button',
            slot: 'confirm_action.confirm',
            props: { variant: 'primary' },
            action: 'confirm',
          },
        ],
      },
    ),
  },

  progress_task: {
    id: 'progress_task',
    maxWidth: 360,
    surfaces: ['surface'],
    tree: card(
      { type: 'Label', slot: 'progress_task.status' },
      { type: 'Heading', slot: 'progress_task.title', props: { level: 2 }, lines: 1 },
      { type: 'Progress', slot: 'progress_task.progress' },
      { type: 'Rule', slot: 'progress_task.detail' },
      {
        type: 'Button',
        slot: 'progress_task.cancel',
        props: { variant: 'ghost' },
        action: 'cancel',
      },
    ),
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];
