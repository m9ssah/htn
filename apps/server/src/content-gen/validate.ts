import { CATALOG, generatableFieldNames } from './catalog.js';
import {
  ContentGenerationRequestV1,
  ContentGenerationResultV1,
  type LeafComponent,
} from './contract.js';

/**
 * The dataset (and, unmodified, the production) validator.
 *
 * Two passes. The Zod schemas in `contract.ts` catch shape violations — wrong
 * type, extra top-level key, `null` where the union does not allow it. This
 * file catches everything the contract states in prose rather than in a type:
 * "no unrequested fields," "optional fields are omitted rather than null,"
 * "no Markdown or explanatory wrapper," "the model only generates fields
 * explicitly listed under fields." A record can pass Zod and still violate
 * every one of those.
 */

export type Violation = {
  rule: string;
  elementId?: string;
  field?: string;
  detail: string;
};

export type ValidationResult = { valid: boolean; violations: Violation[] };

/** Very deliberately narrow: a false positive here trains the model to avoid ordinary punctuation. */
const MARKDOWN_OR_WRAPPER = /(\*\*|__|^#{1,6}\s|`{1,3}|^(Sure|Here('?s| is)|Certainly)\b)/i;

export function validateContentResult(
  requestUnknown: unknown,
  resultUnknown: unknown,
): ValidationResult {
  const violations: Violation[] = [];

  const requestParsed = ContentGenerationRequestV1.safeParse(requestUnknown);
  if (!requestParsed.success) {
    return {
      valid: false,
      violations: requestParsed.error.issues.map((issue) => ({
        rule: 'invalid_request_shape',
        detail: `${issue.path.join('.')}: ${issue.message}`,
      })),
    };
  }
  const request = requestParsed.data;

  const resultParsed = ContentGenerationResultV1.safeParse(resultUnknown);
  if (!resultParsed.success) {
    return {
      valid: false,
      violations: resultParsed.error.issues.map((issue) => ({
        rule: 'invalid_result_shape',
        detail: `${issue.path.join('.')}: ${issue.message}`,
      })),
    };
  }
  const result = resultParsed.data;

  if (result.requestId !== request.requestId) {
    violations.push({
      rule: 'request_id_mismatch',
      detail: `request ${request.requestId} vs result ${result.requestId}`,
    });
  }
  if (result.catalogVersion !== request.catalogVersion) {
    violations.push({
      rule: 'catalog_version_mismatch',
      detail: `request ${request.catalogVersion} vs result ${result.catalogVersion}`,
    });
  }

  const targetsById = new Map(request.targets.map((t) => [t.elementId, t]));

  // No unrequested element IDs.
  for (const elementId of Object.keys(result.values)) {
    if (!targetsById.has(elementId)) {
      violations.push({ rule: 'unrequested_element', elementId, detail: 'not present in targets' });
    }
  }

  for (const target of request.targets) {
    const values = result.values[target.elementId];
    const requested = new Map(target.fields.map((f) => [f.name, f] as const));
    const generatable = generatableFieldNames(target.component as LeafComponent);
    const fixedOnly = new Set(CATALOG[target.component as LeafComponent].fixedOnly);

    // Required fields must exist on a target that has any at all.
    const missingTarget = values === undefined && target.fields.some((f) => f.required);
    if (missingTarget) {
      violations.push({
        rule: 'missing_target',
        elementId: target.elementId,
        detail: 'target has required fields but no entry in values',
      });
      continue;
    }
    if (values === undefined) continue;

    for (const field of target.fields) {
      const value = values[field.name];
      if (value === undefined) {
        if (field.required) {
          violations.push({
            rule: 'missing_required_field',
            elementId: target.elementId,
            field: field.name,
            detail: 'required field absent from values',
          });
        }
        continue;
      }
      if (value === null) {
        violations.push({
          rule: 'null_instead_of_omitted',
          elementId: target.elementId,
          field: field.name,
          detail: 'optional fields must be omitted, never null',
        });
        continue;
      }

      const actualType =
        typeof value === 'boolean'
          ? 'boolean'
          : typeof value === 'number'
            ? 'number'
            : Array.isArray(value)
              ? 'number[]'
              : 'string';
      if (actualType !== field.type) {
        violations.push({
          rule: 'wrong_type',
          elementId: target.elementId,
          field: field.name,
          detail: `expected ${field.type}, got ${actualType}`,
        });
        continue;
      }

      if (typeof value === 'string') {
        const c = field.constraints;
        if (c?.minLength !== undefined && value.length < c.minLength) {
          violations.push({
            rule: 'below_min_length',
            elementId: target.elementId,
            field: field.name,
            detail: `${value.length} < ${c.minLength}`,
          });
        }
        if (c?.maxLength !== undefined && value.length > c.maxLength) {
          violations.push({
            rule: 'exceeds_max_length',
            elementId: target.elementId,
            field: field.name,
            detail: `${value.length} > ${c.maxLength}`,
          });
        }
        if (c?.format === 'plain-text' && MARKDOWN_OR_WRAPPER.test(value)) {
          violations.push({
            rule: 'markdown_or_explanatory_wrapper',
            elementId: target.elementId,
            field: field.name,
            detail: value,
          });
        }
      }
    }

    // No unrequested FIELDS on a requested element, and no business-fact
    // field slipping into `values` even if it happens to also be requested —
    // the catalog says who owns a field regardless of what a bad target asked for.
    for (const fieldName of Object.keys(values)) {
      if (fixedOnly.has(fieldName)) {
        violations.push({
          rule: 'generated_a_fixed_only_field',
          elementId: target.elementId,
          field: fieldName,
          detail: `${fieldName} on ${target.component} is a business fact, never generated`,
        });
        continue;
      }
      if (!requested.has(fieldName)) {
        violations.push({
          rule: 'unrequested_field',
          elementId: target.elementId,
          field: fieldName,
          detail: 'not present in target.fields',
        });
        continue;
      }
      if (!generatable.has(fieldName)) {
        violations.push({
          rule: 'field_not_in_catalog',
          elementId: target.elementId,
          field: fieldName,
          detail: `${fieldName} is not a generatable field of ${target.component}`,
        });
      }
    }
  }

  return { valid: violations.length === 0, violations };
}
