#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ContentGenerationRequestV1, ContentGenerationResultV1 } from './contract.js';

/**
 * `npm run dataset:schemas` — regenerates the JSON Schemas from the Zod
 * source of truth. Never hand-edit the output.
 *
 * Uses Zod v4's own `z.toJSONSchema`, not the third-party `zod-to-json-schema`
 * package — that package targets Zod v3's internals and throws a type error
 * against v4's schema classes. One fewer dependency, and it can't drift out of
 * step with whatever Zod version the workspace is actually on.
 */

const OUT_DIR = fileURLToPath(new URL('../../../../training/content-model/schema/', import.meta.url));

function write(name: string, schema: object): void {
  mkdirSync(dirname(`${OUT_DIR}${name}`), { recursive: true });
  writeFileSync(`${OUT_DIR}${name}`, JSON.stringify(schema, null, 2) + '\n', 'utf8');
  console.log(`wrote ${OUT_DIR}${name}`);
}

write('request.schema.json', z.toJSONSchema(ContentGenerationRequestV1));
write('result.schema.json', z.toJSONSchema(ContentGenerationResultV1));
