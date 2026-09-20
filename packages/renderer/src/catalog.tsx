import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import type { ComponentRenderProps, ComponentRegistry } from '@json-render/react';
import { useBoundProp } from '@json-render/react';
import { z } from 'zod';

const base = z.object({ id: z.string().min(1), pending: z.boolean().optional(), reserveLines: z.number().int().min(1).max(4).optional() });
const layout = z.object({});
const childLayout = z.object({});

const componentSchemas = {
  Stack: { props: childLayout, slots: ['default'] },
  Row: { props: childLayout, slots: ['default'] },
  Grid: { props: childLayout, slots: ['default'] },
  Card: { props: childLayout, slots: ['default'] },
  Divider: { props: layout },
  ButtonGroup: { props: childLayout, slots: ['default'] },
  Heading: { props: base.extend({ text: z.string(), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }) },
  Text: { props: base.extend({ text: z.string(), tone: z.enum(['default', 'muted']).optional() }) },
  Label: { props: base.extend({ text: z.string() }) },
  Metric: { props: base.extend({ label: z.string(), value: z.string(), delta: z.string().optional() }) },
  Media: { props: base.extend({ caption: z.string().optional(), src: z.string().optional() }) },
  Badge: { props: base.extend({ text: z.string() }) },
  ListItem: { props: base.extend({ title: z.string(), detail: z.string().optional(), meta: z.string().optional(), interactive: z.boolean().optional(), hasDetail: z.boolean().optional() }) },
  Bars: { props: base.extend({ values: z.array(z.number()).min(1).max(12) }) },
  Rule: { props: base.extend({ left: z.string(), right: z.string().optional() }) },
  Button: { props: base.extend({ text: z.string(), variant: z.enum(['primary', 'secondary', 'ghost']).optional() }) },
  TextField: { props: base.extend({ label: z.string(), placeholder: z.string().optional(), value: z.string().optional() }) },
  Toggle: { props: base.extend({ label: z.string(), on: z.boolean() }) },
  Progress: { props: base.extend({ pct: z.number().min(0).max(100) }) },
  Alert: { props: base.extend({ text: z.string() }) },
  Slider: { props: base.extend({ label: z.string(), min: z.number(), max: z.number(), step: z.number().positive(), value: z.number(), unit: z.string().optional(), minLabel: z.string().optional(), maxLabel: z.string().optional() }) },
};

export const JIT_CATALOG_VERSION = 'jit-device.v2';

/** json-render's catalog is the single allow-list for generated surface structure. */
export const JIT_CATALOG = defineCatalog(schema, {
  components: componentSchemas,
  actions: {},
});

type Props = Record<string, unknown>;
type RenderProps = ComponentRenderProps<Props>;
const string = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bool = (value: unknown) => value === true;
const boundAction = (props: RenderProps, event: string) => {
  const binding = props.element.on?.[event];
  return !Array.isArray(binding) && binding ? binding.action : undefined;
};

function leafProps(props: Props) {
  return {
    'data-slot': string(props.id),
    'data-shimmer': bool(props.pending) ? '' : undefined,
    style: { '--ph-lines': String(number(props.reserveLines, 1)) } as React.CSSProperties,
  };
}

const Stack = ({ children }: RenderProps) => <div className="c-stack">{children}</div>;
const Row = ({ children }: RenderProps) => <div className="c-row">{children}</div>;
const Grid = ({ children }: RenderProps) => <div className="c-grid">{children}</div>;
const Card = ({ children }: RenderProps) => <div className="c-card">{children}</div>;
const Divider = () => <hr className="c-divider" />;
const ButtonGroup = ({ children }: RenderProps) => <div className="c-btngroup">{children}</div>;

const Heading = ({ element }: RenderProps) => {
  const props = element.props;
  const Tag = `h${number(props.level, 2)}` as 'h1' | 'h2' | 'h3';
  return <Tag className="c-heading" data-level={number(props.level, 2)} {...leafProps(props)}>{string(props.text)}</Tag>;
};
const Text = ({ element }: RenderProps) => <p className="c-text" data-tone={string(element.props.tone) || 'default'} {...leafProps(element.props)}>{string(element.props.text)}</p>;
const Label = ({ element }: RenderProps) => <span className="c-label" {...leafProps(element.props)}>{string(element.props.text)}</span>;
const Metric = ({ element }: RenderProps) => {
  const props = element.props;
  return <div className="c-metric" {...leafProps(props)}><span className="c-label">{string(props.label)}</span><div className="m-value">{string(props.value)}</div><div className="m-delta">{string(props.delta)}</div></div>;
};
/**
 * A still or a clip, decided by the source rather than by a second component.
 *
 * `src` used to be painted only as a background image, so a video URL showed
 * a blank box. Playing it inline keeps the vocabulary at the same size — one
 * `Media`, same props — while letting "show me how" actually move.
 *
 * Muted, looping and `playsInline` because it is decoration on a kiosk, not
 * something anyone presses play on: autoplay is only permitted while muted,
 * and a clip that needed a tap would need a control the rail has no room for.
 */
const VIDEO = /\.(mp4|webm|ogv|ogg|mov)(\?|$)/i;

const Media = ({ element }: RenderProps) => {
  const props = element.props;
  const src = string(props.src);
  const leaf = leafProps(props);
  const caption = <span className="m-caption">{string(props.caption)}</span>;
  if (src && VIDEO.test(src)) {
    return (
      <div className="c-media" {...leaf}>
        <video className="m-video" src={src} autoPlay muted loop playsInline />
        {caption}
      </div>
    );
  }
  return <div className="c-media" {...leaf} style={{ ...leaf.style, backgroundImage: src ? `url("${src}")` : undefined }}>{caption}</div>;
};
const Badge = ({ element }: RenderProps) => <span className="c-badge" {...leafProps(element.props)}>{string(element.props.text)}</span>;
const ListItem = (renderProps: RenderProps) => {
  const { element, emit } = renderProps;
  const props = element.props;
  const interactive = bool(props.interactive);
  return <div className="c-listitem" data-has-detail={bool(props.hasDetail) ? 'true' : 'false'} data-action={boundAction(renderProps, 'press')} {...leafProps(props)} role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined} onClick={interactive ? () => emit('press') : undefined}><span className="li-main"><span className="li-title">{string(props.title)}</span><span className="li-detail">{string(props.detail)}</span></span><span className="li-meta">{string(props.meta)}</span></div>;
};
const Bars = ({ element }: RenderProps) => <div className="c-bars" {...leafProps(element.props)}>{(Array.isArray(element.props.values) ? element.props.values : [42, 66, 34, 78, 52]).map((height, index) => <i className="b-bar" key={index} style={{ height: `${Math.max(0, Math.min(100, number(height)))}%` }} />)}</div>;
const Rule = ({ element }: RenderProps) => <div className="c-rule" {...leafProps(element.props)}><span className="r-left">{string(element.props.left)}</span><span className="r-right">{string(element.props.right)}</span></div>;
const Button = (renderProps: RenderProps) => { const { element, emit } = renderProps; return <button type="button" className="c-btn" data-variant={string(element.props.variant) || 'primary'} data-action={boundAction(renderProps, 'press')} {...leafProps(element.props)} onClick={() => emit('press')}>{string(element.props.text)}</button>; };
const TextField = (renderProps: RenderProps) => {
  const { element, bindings, emit } = renderProps;
  const props = element.props;
  const [value, setValue] = useBoundProp<string>(string(props.value), bindings?.value);
  return <label className="c-field" data-action={boundAction(renderProps, 'text')} {...leafProps(props)}><span className="c-label">{string(props.label)}</span><input className="f-input" type="text" value={value ?? ''} placeholder={string(props.placeholder)} onChange={(event) => setValue(event.target.value)} onBlur={() => emit('text')} /></label>;
};
const Toggle = (renderProps: RenderProps) => { const { element, emit } = renderProps; return <button type="button" className="c-toggle" role="switch" aria-checked={bool(element.props.on)} data-on={bool(element.props.on) ? 'true' : 'false'} data-action={boundAction(renderProps, 'toggle')} {...leafProps(element.props)} onClick={() => emit('toggle')}><span className="t-label">{string(element.props.label)}</span><span className="t-switch" /></button>; };
const Progress = ({ element }: RenderProps) => { const pct = Math.max(0, Math.min(100, number(element.props.pct))); return <div className="c-progress" role="progressbar" aria-valuenow={pct} {...leafProps(element.props)}><i className="p-fill" style={{ width: `${pct}%` }} /></div>; };
const Alert = ({ element }: RenderProps) => <div className="c-alert" role="alert" {...leafProps(element.props)}>{string(element.props.text)}</div>;
const Slider = (renderProps: RenderProps) => {
  const { element, emit } = renderProps;
  const props = element.props;
  return <div className="c-slider" data-action={boundAction(renderProps, 'range')} data-has-poles={string(props.minLabel) || string(props.maxLabel) ? 'true' : 'false'} {...leafProps(props)}><div className="s-head"><span className="c-label">{string(props.label)}</span><span className="s-value">{string(props.unit) ? `${number(props.value)} ${string(props.unit)}` : ''}</span></div><input className="s-input" type="range" min={number(props.min)} max={number(props.max)} step={number(props.step, 1)} value={number(props.value)} onChange={() => emit('range')} /><div className="s-poles"><span className="s-min">{string(props.minLabel)}</span><span className="s-max">{string(props.maxLabel)}</span></div></div>;
};

export const JIT_REGISTRY: ComponentRegistry = {
  Stack, Row, Grid, Card, Divider, ButtonGroup,
  Heading, Text, Label, Metric, Media, Badge, ListItem, Bars, Rule,
  Button, TextField, Toggle, Progress, Alert, Slider,
};
