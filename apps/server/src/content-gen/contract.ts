import { z } from 'zod';

/**
 * Stage 2's wire contract: `jit.content.request.v1` / `jit.content.result.v1`.
 *
 * This is the runtime validator, not just documentation. Every synthetic
 * record the generator produces is checked against these schemas before it is
 * allowed into the dataset, and the same schemas gate a real model response in
 * production — so a record that would be rejected on the device cannot ship as
 * a training example either.
 *
 * The shape here is fixed by the migration contract ("2. Contracts, Catalog,
 * and Renderer" / "Stage 2"). Do not add fields Stage 2 does not need: the
 * whole point of this stage is that the model receives nothing it could use to
 * reconstruct structure, styling or business facts on its own.
 */

export const CATALOG_VERSION = 'jit-device.v2' as const;

export const FieldType = z.enum(['string', 'number', 'boolean', 'number[]']);
export type FieldType = z.infer<typeof FieldType>;

export const FieldConstraints = z
  .object({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().positive().optional(),
    allowedValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
    format: z.literal('plain-text').optional(),
  })
  .strict();
export type FieldConstraints = z.infer<typeof FieldConstraints>;

export const FieldSpec = z
  .object({
    name: z.string().min(1),
    type: FieldType,
    required: z.boolean(),
    constraints: FieldConstraints.optional(),
  })
  .strict();
export type FieldSpec = z.infer<typeof FieldSpec>;

/** The 15 leaf components. Structural components never appear here — Stage 2 never sees layout. */
export const LeafComponent = z.enum([
  'Heading',
  'Text',
  'Label',
  'Metric',
  'Media',
  'Badge',
  'ListItem',
  'Bars',
  'Rule',
  'Button',
  'TextField',
  'Toggle',
  'Progress',
  'Alert',
  'Slider',
]);
export type LeafComponent = z.infer<typeof LeafComponent>;

const JsonPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
/** Deliberately shallow. `fixed`/`sourceFacts` carry data, never structure. */
export const JsonObject = z.record(z.string(), JsonPrimitive);
export type JsonObject = z.infer<typeof JsonObject>;
export type JsonValue = z.infer<typeof JsonPrimitive>;

export const TargetSpec = z
  .object({
    elementId: z.string().min(1),
    component: LeafComponent,
    purpose: z.string().min(1),
    fields: z.array(FieldSpec).min(1),
    fixed: JsonObject,
    sourceFacts: JsonObject.optional(),
  })
  .strict();
export type TargetSpec = z.infer<typeof TargetSpec>;

export const ContentGenerationRequestV1 = z
  .object({
    contract: z.literal('jit.content.request.v1'),
    requestId: z.string().min(1),
    catalogVersion: z.literal(CATALOG_VERSION),
    locale: z.string().min(2),
    intent: z.string().min(1),
    context: JsonObject,
    targets: z.array(TargetSpec).min(1),
  })
  .strict();
export type ContentGenerationRequestV1 = z.infer<typeof ContentGenerationRequestV1>;

// `null` IS a member of the wire union, deliberately. A model returning null
// for an optional field is a real, expected mistake (the contract calls it
// out by name: "omitted rather than returned as null") and the semantic
// validator in validate.ts gives it a specific, actionable rule name. Excluding
// null here would only demote that mistake to a generic shape-parse failure.
const ResultValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.number()), z.null()]);

export const ContentGenerationResultV1 = z
  .object({
    contract: z.literal('jit.content.result.v1'),
    requestId: z.string().min(1),
    // NOT pinned to the CATALOG_VERSION literal, on purpose — same reasoning as
    // requestId just above it. "requestId and catalogVersion must match" is a
    // relationship between the request and the result, not an independent
    // constant either one must satisfy; validate.ts checks the two AGREE, which
    // is what lets a mismatch surface as the specific `catalog_version_mismatch`
    // rule instead of a generic shape failure.
    catalogVersion: z.string().min(1),
    values: z.record(z.string(), z.record(z.string(), ResultValue)),
  })
  .strict();
export type ContentGenerationResultV1 = z.infer<typeof ContentGenerationResultV1>;

/**
 * One JSONL training record: the request Stage 2 receives, and the result it
 * must produce. Kept as a pair rather than as separate files so a training
 * pipeline never has to join two datasets by `requestId` and risk skew between
 * them.
 */
export const ContentTrainingRecord = z
  .object({
    request: ContentGenerationRequestV1,
    result: ContentGenerationResultV1,
    /**
     * Present only on a record manufactured to be rejected. Never sent to a
     * model — this is dataset metadata for the validator and for whoever is
     * building the rejection-path tests, not part of the wire contract.
     */
    expectRejection: z
      .object({
        rule: z.string(),
        elementId: z.string().optional(),
        field: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ContentTrainingRecord = z.infer<typeof ContentTrainingRecord>;

/**
 * The permissive read-side counterpart of `ContentTrainingRecord`.
 *
 * `request`/`result` are `z.unknown()` here on purpose: a rejection-tagged row
 * is deliberately not a valid `ContentGenerationResultV1` (wrong catalog
 * version, a stray `null`, ...), so parsing it with the strict wire schema
 * would fail before `validateContentResult` — the function actually meant to
 * judge it — ever runs. This envelope only checks that the JSONL row has the
 * right shape to be interpreted at all; semantic validity is `validate.ts`'s
 * job, not this schema's.
 */
export const TrainingRecordEnvelope = z
  .object({
    request: z.unknown(),
    result: z.unknown(),
    expectRejection: z
      .object({ rule: z.string(), elementId: z.string().optional(), field: z.string().optional() })
      .strict()
      .optional(),
  })
  .strict();
export type TrainingRecordEnvelope = z.infer<typeof TrainingRecordEnvelope>;
