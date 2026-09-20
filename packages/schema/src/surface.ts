import { z } from 'zod';
import type { PolishPatch, StylePatch } from './index.js';

/** The catalog is finite. Model output may only refer to these names. */
export const STRUCTURAL_COMPONENTS = [
  'Stack', 'Row', 'Grid', 'Card', 'Divider', 'ButtonGroup',
] as const;
export const LEAF_COMPONENTS = [
  'Heading', 'Text', 'Label', 'Metric', 'Media', 'Badge', 'ListItem', 'Bars',
  'Rule', 'Button', 'TextField', 'Toggle', 'Progress', 'Alert', 'Slider',
] as const;
export const COMPONENTS = [...STRUCTURAL_COMPONENTS, ...LEAF_COMPONENTS] as const;

export type StructuralComponentV2 = (typeof STRUCTURAL_COMPONENTS)[number];
export type LeafComponentV2 = (typeof LEAF_COMPONENTS)[number];
export type ComponentTypeV2 = (typeof COMPONENTS)[number];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));
export type JsonObject = { [key: string]: JsonValue };

const StateExpressionSchema = z.object({ $state: z.string().startsWith('/') }).strict();
const BindStateExpressionSchema = z.object({ $bindState: z.string().startsWith('/') }).strict();
export const PropValueSchema = z.union([JsonValueSchema, StateExpressionSchema, BindStateExpressionSchema]);

export const SpecElementSchema = z.object({
  type: z.enum(COMPONENTS),
  props: z.record(z.string(), PropValueSchema),
  children: z.array(z.string().min(1)).optional(),
  slots: z.record(z.string(), z.array(z.string().min(1))).optional(),
  visible: z.union([z.boolean(), z.object({ $state: z.string().startsWith('/') }).passthrough()]).optional(),
  on: z.record(z.string(), z.object({
    action: z.string().min(1),
    params: z.record(z.string(), PropValueSchema).optional(),
  }).strict()).optional(),
}).strict();

/** The standard flat json-render Spec format, restricted to this device's v1 subset. */
export const SurfaceSpecSchema = z.object({
  root: z.string().min(1),
  elements: z.record(z.string().min(1), SpecElementSchema),
  state: z.record(z.string(), JsonValueSchema).optional(),
}).strict();
export type SurfaceSpec = z.infer<typeof SurfaceSpecSchema>;

export const StructureUpdateSchema = z.object({
  v: z.literal(2),
  stage: z.literal('structure'),
  requestId: z.string().min(1),
  generationId: z.string().min(1),
  maxWidth: z.number().int().min(320).max(760),
  status: z.enum(['partial', 'complete']),
  spec: SurfaceSpecSchema,
}).strict();
export type StructureUpdateV2 = z.infer<typeof StructureUpdateSchema>;

export const ContentUpdateSchema = z.object({
  v: z.literal(2),
  stage: z.literal('content'),
  requestId: z.string().min(1),
  generationId: z.string().min(1),
  complete: z.boolean(),
  values: z.record(z.string().min(1), z.record(z.string(), JsonValueSchema)),
}).strict();
export type ContentUpdateV2 = z.infer<typeof ContentUpdateSchema>;

export type StyleUpdateV1 = StylePatch & { stage?: 'style' };
export type PolishUpdateV1 = PolishPatch & { stage?: 'polish' };
export type SurfaceUpdate = StructureUpdateV2 | ContentUpdateV2 | StyleUpdateV1 | PolishUpdateV1;

export const ContentFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'number[]']),
  required: z.boolean(),
  constraints: z.object({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().positive().optional(),
    allowedValues: z.array(JsonValueSchema).optional(),
    format: z.literal('plain-text').optional(),
  }).strict().optional(),
}).strict();

export const ContentTargetSchema = z.object({
  elementId: z.string().min(1),
  component: z.enum(LEAF_COMPONENTS),
  purpose: z.string().min(1),
  fields: z.array(ContentFieldSchema).min(1),
  fixed: z.record(z.string(), JsonValueSchema),
  sourceFacts: z.record(z.string(), JsonValueSchema).optional(),
}).strict();

export const ContentGenerationRequestSchema = z.object({
  contract: z.literal('jit.content.request.v1'),
  requestId: z.string().min(1),
  catalogVersion: z.literal('jit-device.v2'),
  locale: z.string().min(2),
  intent: z.string().min(1),
  context: z.record(z.string(), JsonValueSchema),
  targets: z.array(ContentTargetSchema),
}).strict();
export type ContentGenerationRequestV1 = z.infer<typeof ContentGenerationRequestSchema>;

export const ContentGenerationResultSchema = z.object({
  contract: z.literal('jit.content.result.v1'),
  requestId: z.string().min(1),
  catalogVersion: z.literal('jit-device.v2'),
  values: z.record(z.string().min(1), z.record(z.string(), JsonValueSchema)),
}).strict();
export type ContentGenerationResultV1 = z.infer<typeof ContentGenerationResultSchema>;

export type SurfaceActionDescriptor = {
  index: number;
  action: string;
  elementId: string;
  kind: 'press' | 'toggle' | 'text' | 'range';
  label: string | null;
  range: { min: number; max: number; step: number; value: number; unit: string | null; minLabel: string | null; maxLabel: string | null } | null;
};

export const BUTTON_COUNT_V2 = 4;
export const RANGE_CONTROL_COUNT_V2 = 1;
