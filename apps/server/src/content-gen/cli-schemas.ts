#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ContentGenerationRequestV1, ContentGenerationResultV1 } from './contract.js';

/** `npm run dataset:schemas` — regenerates the JSON Schemas from the Zod source of truth. Never hand-edit the output. */

const OUT_DIR = fileURLToPath(new URL('../../../../training/content-model/schema/', import.meta.url));

function write(name: string, schema: object): void {
  mkdirSync(dirname(`${OUT_DIR}${name}`), { recursive: true });
  writeFileSync(`${OUT_DIR}${name}`, JSON.stringify(schema, null, 2) + '\n', 'utf8');
  console.log(`wrote ${OUT_DIR}${name}`);
}

write('request.schema.json', zodToJsonSchema(ContentGenerationRequestV1, 'ContentGenerationRequestV1'));
write('result.schema.json', zodToJsonSchema(ContentGenerationResultV1, 'ContentGenerationResultV1'));
