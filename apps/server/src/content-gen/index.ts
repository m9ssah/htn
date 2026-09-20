export {
  CATALOG_VERSION,
  ContentGenerationRequestV1,
  ContentGenerationResultV1,
  ContentTrainingRecord,
  FieldSpec,
  LeafComponent,
  TargetSpec,
  TrainingRecordEnvelope,
  type FieldConstraints,
  type FieldType,
  type JsonObject,
  type JsonValue,
} from './contract.js';
export { CATALOG, FIXED_VARIANTS, generatableFieldNames, type ComponentCatalogEntry } from './catalog.js';
export { LOCALES, SCENARIO_BUILDERS, type Locale, type ScenarioPair } from './scenarios.js';
export { synthesize, type Coverage } from './synthesize.js';
export { validateContentResult, type ValidationResult, type Violation } from './validate.js';
export { fixtureContentAdapter, UnknownFixtureShapeError } from './fixture-adapter.js';
