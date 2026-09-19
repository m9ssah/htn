import type { ContentPatch, PolishPatch, StylePatch, TemplateId } from '@jit/schema';

/**
 * Scenarios exist only in the harness. The renderer takes patches and paints; it
 * has no idea what a "user intent" is, and shipping demo content inside it would
 * be the first step toward a lookup table.
 *
 * Arrow glyphs are restricted to U+2191/U+2193, which are inside the bundled
 * Jost latin subset. U+2197 is not, and would fall back mid-word.
 */
export type Scenario = {
  intent: string;
  templateId: TemplateId;
  content: ContentPatch;
  style: StylePatch;
  /** Null where agent 4 would have nothing novel to add. */
  polish: PolishPatch | null;
};

export const SCENARIOS: Scenario[] = [
  {
    intent: 'I just need to trim this clip',
    templateId: 'task_focus',
    content: {
      v: 1,
      slots: {
        'task_focus.badge': { kind: 'Badge', text: 'Trim' },
        'task_focus.title': { kind: 'Heading', text: 'Clip 4' },
        'task_focus.preview': { kind: 'Media', caption: 'preview' },
        'task_focus.range': { kind: 'Rule', left: '00:12.40 – 00:47.10', right: '34.7s' },
        'task_focus.markIn': { kind: 'Button', text: 'Mark in' },
        'task_focus.markOut': { kind: 'Button', text: 'Mark out' },
        'task_focus.confirm': { kind: 'Button', text: 'Apply trim' },
      },
    },
    style: {
      v: 1,
      theme: {
        palette: 'slate',
        fontPairing: 'system',
        density: 'normal',
        radius: 'soft',
        motif: 'none',
      },
    },
    polish: {
      v: 1,
      interpretedAs: 'pared-back cutting tool, nothing decorative',
      tokens: {
        '--jit-bg': '#0a0b0d',
        '--jit-surface': '#121417',
        '--jit-border': '#1f242a',
        '--jit-accent': '#4ade80',
        '--jit-on-accent': '#04150b',
        '--jit-fg': '#eef2f4',
        '--jit-muted': '#93a1ac',
        '--jit-radius': '6px',
        '--jit-radius-sm': '4px',
        '--jit-accent-soft': '#0f2418',
      },
    },
  },

  {
    intent: 'show me my train ticket',
    templateId: 'ticket_detail',
    content: {
      v: 1,
      slots: {
        'ticket_detail.operator': { kind: 'Label', text: 'LNER / e-ticket' },
        'ticket_detail.title': { kind: 'Heading', text: 'London to Edinburgh' },
        'ticket_detail.summary': { kind: 'Text', text: 'Mon 21 Sep · Direct · 4h 22m' },
        'ticket_detail.origin': { kind: 'Metric', label: "King's Cross", value: '08:30' },
        'ticket_detail.destination': { kind: 'Metric', label: 'Waverley', value: '12:52' },
        'ticket_detail.seat': { kind: 'Rule', left: 'Standard · Coach C · Seat 24', right: 'K9QP2' },
        'ticket_detail.view': { kind: 'Button', text: 'View ticket' },
      },
    },
    style: {
      v: 1,
      theme: {
        palette: 'mono',
        fontPairing: 'system',
        density: 'normal',
        radius: 'soft',
        motif: 'none',
      },
    },
    polish: {
      v: 1,
      interpretedAs: 'rail operator livery, ticket-stock feel',
      tokens: {
        '--jit-bg': '#1b1b1d',
        '--jit-surface': '#fbfaf7',
        '--jit-border': '#ded9d0',
        '--jit-accent': '#c4122f',
        '--jit-on-accent': '#ffffff',
        '--jit-fg': '#18181a',
        '--jit-muted': '#5f5a52',
        '--jit-radius': '4px',
        '--jit-radius-sm': '3px',
        '--jit-accent-soft': '#fbe9ec',
      },
    },
  },

  {
    intent: 'log me in',
    templateId: 'auth_form',
    content: {
      v: 1,
      slots: {
        'auth_form.title': { kind: 'Heading', text: 'Sign in' },
        'auth_form.subtitle': { kind: 'Text', text: 'Continue to your workspace.' },
        'auth_form.email': { kind: 'TextField', label: 'Email', placeholder: 'you@company.com' },
        'auth_form.password': {
          kind: 'TextField',
          label: 'Password',
          placeholder: 'Enter your password',
        },
        'auth_form.submit': { kind: 'Button', text: 'Sign in' },
        'auth_form.recover': { kind: 'Button', text: 'Forgot password?' },
      },
    },
    style: {
      v: 1,
      theme: {
        palette: 'slate',
        fontPairing: 'geometric',
        density: 'normal',
        radius: 'soft',
        motif: 'none',
      },
    },
    polish: {
      v: 1,
      interpretedAs: 'restrained product auth, single accent',
      tokens: {
        '--jit-bg': '#0d0f13',
        '--jit-surface': '#15181e',
        '--jit-border': '#242933',
        '--jit-accent': '#e8e8ea',
        '--jit-on-accent': '#15181e',
        '--jit-fg': '#eceef2',
        '--jit-muted': '#98a1b0',
        '--jit-radius': '14px',
        '--jit-radius-sm': '9px',
        '--jit-accent-soft': '#1d2129',
      },
    },
  },

  {
    intent: 'how did sales do this month',
    templateId: 'dashboard',
    content: {
      v: 1,
      slots: {
        'dashboard.title': { kind: 'Heading', text: 'Overview' },
        'dashboard.period': { kind: 'Text', text: 'Aug 1–31, 2026' },
        'dashboard.primaryMetric': {
          kind: 'Metric',
          label: 'Net revenue',
          value: '$48,250',
          delta: '↑ 4.6%',
        },
        'dashboard.secondaryMetric': {
          kind: 'Metric',
          label: 'Orders',
          value: '384',
          delta: '↓ 2.3%',
        },
        'dashboard.tertiaryMetric': {
          kind: 'Metric',
          label: 'Avg order',
          value: '$125.65',
          delta: '↑ 7.1%',
        },
        'dashboard.chartLabel': { kind: 'Label', text: 'Weekly revenue' },
        'dashboard.chart': { kind: 'Bars', values: [52, 38, 78, 60] },
        'dashboard.listLabel': { kind: 'Label', text: 'Recent payouts' },
        'dashboard.item1': { kind: 'ListItem', title: 'Aug 28', meta: '$6,405.50' },
        'dashboard.item2': { kind: 'ListItem', title: 'Aug 21', meta: '$11,280.00' },
        'dashboard.item3': { kind: 'ListItem', title: 'Aug 14', meta: '$9,140.25' },
      },
    },
    style: {
      v: 1,
      theme: {
        palette: 'mono',
        fontPairing: 'system',
        density: 'compact',
        radius: 'soft',
        motif: 'none',
      },
    },
    polish: {
      v: 1,
      interpretedAs: 'dense analyst view, low chrome, numbers first',
      tokens: {
        '--jit-bg': '#fbfcfd',
        '--jit-surface': '#ffffff',
        '--jit-border': '#e4e9ef',
        '--jit-accent': '#1d4ed8',
        '--jit-on-accent': '#ffffff',
        '--jit-fg': '#0f1620',
        '--jit-muted': '#55647a',
        '--jit-radius': '10px',
        '--jit-radius-sm': '6px',
        '--jit-gap': '10px',
        '--jit-pad': '18px',
        '--jit-scale': '0.96',
        '--jit-accent-soft': '#e8effc',
      },
    },
  },

  {
    intent: 'too much going on — just let me read',
    templateId: 'reader',
    content: {
      v: 1,
      slots: {
        'reader.title': { kind: 'Heading', text: 'The quiet interface' },
        'reader.byline': { kind: 'Text', text: '4 min read · updated today' },
        'reader.para1': {
          kind: 'Text',
          text: 'Every control that is present but unused is a decision the reader pays for.',
        },
        'reader.para2': {
          kind: 'Text',
          text: 'Subsetting is not simplification. The capability remains; only what is currently irrelevant is withdrawn from view.',
        },
        'reader.para3': {
          kind: 'Text',
          text: 'When intent changes, the surface changes with it.',
        },
      },
    },
    style: {
      v: 1,
      theme: {
        palette: 'mono',
        fontPairing: 'editorial',
        density: 'spacious',
        radius: 'sharp',
        motif: 'none',
      },
    },
    polish: {
      v: 1,
      interpretedAs: 'quiet long-form reading, warm paper, editorial',
      tokens: {
        '--jit-bg': '#f4f1ea',
        '--jit-surface': '#f4f1ea',
        '--jit-border': '#ded8cb',
        '--jit-accent': '#1a1a18',
        '--jit-on-accent': '#f4f1ea',
        '--jit-fg': '#22201c',
        '--jit-muted': '#5d574d',
        '--jit-radius': '0px',
        '--jit-radius-sm': '0px',
        '--jit-scale': '1.18',
        '--jit-gap': '26px',
        '--jit-accent-soft': '#e8e2d5',
      },
    },
  },

  {
    intent: 'make it softer and calmer',
    templateId: 'settings_panel',
    content: {
      v: 1,
      slots: {
        'settings_panel.title': { kind: 'Heading', text: 'Comfort' },
        'settings_panel.option1': { kind: 'Toggle', label: 'Reduce motion', on: true },
        'settings_panel.option2': { kind: 'Toggle', label: 'Hide metrics', on: true },
        'settings_panel.option3': { kind: 'Toggle', label: 'Larger text', on: true },
        'settings_panel.option4': { kind: 'Toggle', label: 'Mute notifications', on: false },
      },
    },
    style: {
      v: 1,
      theme: {
        palette: 'rose',
        fontPairing: 'editorial',
        density: 'spacious',
        radius: 'round',
        motif: 'floral',
      },
    },
    polish: {
      v: 1,
      interpretedAs: 'soft, calm — dusty rose, generous air, blooming edges',
      tokens: {
        '--jit-bg': '#fdf2f4',
        '--jit-surface': '#fffafb',
        '--jit-border': '#f0d3dc',
        '--jit-accent': '#a8325c',
        '--jit-on-accent': '#fffafc',
        '--jit-fg': '#432630',
        '--jit-muted': '#7d5460',
        '--jit-radius': '26px',
        '--jit-radius-sm': '18px',
        '--jit-gap': '24px',
        '--jit-pad': '30px',
        '--jit-scale': '1.06',
        '--jit-accent-soft': '#fae6ec',
      },
    },
  },

  {
    intent: 'delete everything from last week',
    templateId: 'confirm_action',
    content: {
      v: 1,
      slots: {
        'confirm_action.title': { kind: 'Heading', text: 'Confirm deletion' },
        'confirm_action.warning': {
          kind: 'Alert',
          text: 'This removes 47 items recorded between Sep 8 and Sep 14. It cannot be undone.',
        },
        'confirm_action.cancel': { kind: 'Button', text: 'Cancel' },
        'confirm_action.confirm': { kind: 'Button', text: 'Delete 47' },
      },
    },
    style: {
      v: 1,
      theme: {
        palette: 'slate',
        fontPairing: 'system',
        density: 'normal',
        radius: 'soft',
        motif: 'none',
      },
    },
    polish: {
      v: 1,
      interpretedAs: 'destructive confirmation — make the weight felt',
      tokens: {
        '--jit-bg': '#140b08',
        '--jit-surface': '#1e100b',
        '--jit-border': '#3d1f14',
        '--jit-accent': '#e2543a',
        '--jit-on-accent': '#1a0703',
        '--jit-fg': '#f6e4dd',
        '--jit-muted': '#c2a096',
        '--jit-radius': '8px',
        '--jit-radius-sm': '6px',
        '--jit-accent-soft': '#2d130c',
      },
    },
  },

  {
    intent: 'how long until the export is done',
    templateId: 'progress_task',
    content: {
      v: 1,
      slots: {
        'progress_task.status': { kind: 'Label', text: 'Exporting' },
        'progress_task.title': { kind: 'Heading', text: 'final_cut_v3.mp4' },
        'progress_task.progress': { kind: 'Progress', pct: 68 },
        'progress_task.detail': { kind: 'Rule', left: '68% · 1080p', right: '~2m 10s left' },
        'progress_task.cancel': { kind: 'Button', text: 'Cancel export' },
      },
    },
    style: {
      v: 1,
      theme: {
        palette: 'slate',
        fontPairing: 'mono',
        density: 'normal',
        radius: 'soft',
        motif: 'geometric',
      },
    },
    polish: {
      v: 1,
      interpretedAs: 'terminal-flavoured progress readout',
      tokens: {
        '--jit-bg': '#060a07',
        '--jit-surface': '#0b120d',
        '--jit-border': '#1b2a20',
        '--jit-accent': '#35d07f',
        '--jit-on-accent': '#03150b',
        '--jit-fg': '#d6ecdc',
        '--jit-muted': '#8aa695',
        '--jit-radius': '4px',
        '--jit-radius-sm': '2px',
        '--jit-accent-soft': '#0d2116',
      },
    },
  },

  {
    intent: "I can't read this — make it high contrast",
    templateId: 'reader',
    content: {
      v: 1,
      slots: {
        'reader.title': { kind: 'Heading', text: 'The quiet interface' },
        'reader.byline': { kind: 'Text', text: '4 min read' },
        'reader.para1': {
          kind: 'Text',
          text: 'Every control that is present but unused is a decision the reader pays for.',
        },
        'reader.para2': { kind: 'Text', text: 'Subsetting is not simplification.' },
        'reader.para3': { kind: 'Text', text: 'When intent changes, the surface changes with it.' },
      },
    },
    style: {
      v: 1,
      theme: {
        palette: 'contrast',
        fontPairing: 'system',
        density: 'spacious',
        radius: 'sharp',
        motif: 'none',
      },
    },
    polish: {
      v: 1,
      interpretedAs: 'maximum legibility, low vision — push past the preset',
      tokens: {
        '--jit-bg': '#000000',
        '--jit-surface': '#000000',
        '--jit-border': '#ffffff',
        '--jit-accent': '#ffe600',
        '--jit-on-accent': '#000000',
        '--jit-fg': '#ffffff',
        '--jit-muted': '#f2f2f2',
        '--jit-scale': '1.42',
        '--jit-gap': '28px',
        '--jit-pad': '26px',
        '--jit-radius': '0px',
        '--jit-radius-sm': '0px',
        '--jit-accent-soft': '#262200',
        '--jit-weight-display': '800',
      },
    },
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
