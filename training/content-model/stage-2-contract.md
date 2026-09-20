# Stage 2 — content generation contract

Written for: whoever fine-tunes or prompts the Stage 2 content model, and
whoever reviews its output.

## What Stage 1 already decided, and what is left to you

By the time Stage 2 runs, **structure is finished.** Stage 1 (the Jev
composer) has already picked which components appear, where they sit, what
they're wired to, and what size box each one occupies. None of that is yours
to change. You receive one **target** per component that has something for you
to write, and your only job is to fill the **named fields** on each target with
plain text, numbers, or booleans that satisfy the stated constraints.

You do not decide:
- Layout, component choice, or which elements exist.
- Colours, CSS, or anything about how the page looks.
- Prices, quantities, percentages, counts, or any other number the user could
  independently check — these arrive as `fixed` or `sourceFacts` because they
  are business facts computed elsewhere, not creative choices.
- Whether an element appears at all.

You decide:
- Wording. A heading, a button label, a sentence of explanation, a person's
  name as it should appear in a message. Always plain text — no Markdown, no
  "Sure, here's a title:" wrapper, just the value itself.

## The wire contract

**Request** (`contract: "jit.content.request.v1"`) — see
`schema/request.schema.json` for the full JSON Schema, generated from
[`../../apps/server/src/content-gen/contract.ts`](../../apps/server/src/content-gen/contract.ts)
(the Zod source of truth — edit there, never the generated schema by hand).

```json
{
  "contract": "jit.content.request.v1",
  "requestId": "surface-42",
  "catalogVersion": "jit-device.v2",
  "locale": "en-US",
  "intent": "Show the selected cookie recipe",
  "context": { "recipeName": "Classic Chocolate Chip" },
  "targets": [
    {
      "elementId": "title",
      "component": "Heading",
      "purpose": "Recipe name",
      "fields": [
        { "name": "text", "type": "string", "required": true,
          "constraints": { "minLength": 1, "maxLength": 60, "format": "plain-text" } }
      ],
      "fixed": { "level": 1 }
    }
  ]
}
```

**Result** (`contract: "jit.content.result.v1"`):

```json
{
  "contract": "jit.content.result.v1",
  "requestId": "surface-42",
  "catalogVersion": "jit-device.v2",
  "values": { "title": { "text": "Classic Chocolate Chip" } }
}
```

Full worked example: `examples/valid.request.json` / `examples/valid.result.json`.
A deliberately broken twin, `examples/invalid.result.json`, trips two rules at
once (see below) — run `npm run dataset:validate` to see exactly which.

## The rules, in the order the validator checks them

1. `requestId` and `catalogVersion` on the result must **match the request**.
   Not a fixed constant — an agreement between the two. If a request is ever
   reissued under a newer catalog, the result simply has to agree with
   whichever request it is answering.
2. No value for an `elementId` that wasn't in `targets`.
3. Every **required** field on a requested target must be present.
4. **Optional fields are omitted, never `null`.** If you have nothing useful
   to put in `minLabel`, leave the key out of `values[elementId]` entirely.
5. A value's type must match what was requested (`string`/`number`/`boolean`/
   `number[]`), and a string must sit within its `minLength`/`maxLength`.
6. No Markdown, no code fences, no "Sure, here is..." — the field is inserted
   into the UI verbatim, not read by anyone first.
7. No field that the **catalog** marks as a business fact — a price, a
   quantity, a percentage, a boolean toggle state, a URL — ever appears in
   `values`, even if it happens to also be listed in `fields` on a
   malformed target. The catalog's answer always wins.

Every one of these is enforced by
[`validate.ts`](../../apps/server/src/content-gen/validate.ts), which is the
same function that gates a real model response in production — nothing here
is dataset-only.

## Which fields are yours, per component

Full source of truth:
[`catalog.ts`](../../apps/server/src/content-gen/catalog.ts). Summary:

| Component | You may generate | Always fixed |
|---|---|---|
| Heading | `text` | — |
| Text | `text` | — |
| Label | `text` | — |
| Metric | `label` | `value`, `delta` (computed) |
| Media | `caption` (optional) | `src` |
| Badge | `text` | — |
| ListItem | `title`, `detail` (optional) | `meta` (price/time/count) |
| Rule | `left`, `right` (optional) | — |
| Button | `text` | — |
| TextField | `label`, `placeholder` (optional) | `value` (user input) |
| Toggle | `label` | `on` |
| Alert | `text` | — |
| Slider | `label`, `minLabel`/`maxLabel` (optional) | `min`, `max`, `step`, `value`, `unit` |
| Bars | *(none)* | `values` |
| Progress | *(none)* | `pct` |

**Bars and Progress never produce a Stage 2 target at all** — every field
either component has is a business fact, so Stage 1 fills them directly and
Stage 2 never sees them. This is a real, permanent property of the catalog,
not a coverage gap; `content-gen.test.ts` asserts it explicitly so nobody
"fixes" it later by inventing something for the model to generate there.

## The synthetic dataset

`dataset.jsonl` — one JSON object per line, each an entry of

```ts
{ request: ContentGenerationRequestV1; result: ContentGenerationResultV1;
  expectRejection?: { rule: string; elementId?: string; field?: string } }
```

`expectRejection` is present **only** on a record manufactured to fail —
metadata for training/eval, never sent to a model.

Built from six hand-authored domains — `cookie_recipe`, `train_ticket`,
`study_planner`, `travel_rebooking`, `comfort_settings`, `share_message` — each
written in six locales, then mechanically expanded:

- **Optional-present / optional-omitted** pairs for every target that has one.
- **Length-boundary** variants sitting exactly at a field's `maxLength`.
- **Nine rejection categories**, one violated rule per record: missing
  required field, unrequested element, wrong type, over `maxLength`, request/
  result id mismatch, catalog-version mismatch, a Markdown/prose wrapper,
  `null` instead of an omitted key, and a business-fact field the model was
  never asked for.

Six domains, not one, on purpose: Stage 2 has no idea what a recipe is, and a
dataset that was 100% cookies would teach the model cookie vocabulary instead
of the contract's actual shape. `study_planner` doubles as the migration's own
"new cross-domain page" proof, so it is exercised here too.

**Locale honesty, stated plainly:** en-US/es-ES/fr-FR/de-DE are ordinary
sentences. ja-JP and ar-SA are deliberately short, common, low-risk phrases —
they prove the pipeline is locale-parameterised, they are **not**
native-speaker-reviewed copy. Get a native speaker to pass over both before
either influences a shipped model.

## Commands

```bash
npm run dataset:generate   # writes dataset.jsonl from the scenario source
npm run dataset:validate   # checks every record's ACTUAL validity against
                            # what it CLAIMS (its expectRejection, if any) —
                            # reports line number, requestId, rule, and detail
npm run dataset:schemas    # regenerates schema/*.json from the Zod source
```

`dataset:validate` is the gate: a record that claims to be valid but is not,
or a rejection record that fails for the wrong reason, is a dataset bug, and
this command's whole job is to find it before a training run does.

## Adapters

`FixtureContentAdapter` (deterministic, looks up a canonical example — for
tests and offline dev) ships in this PR. The remote fine-tuned-model adapter
is configurable but **no model ID is chosen yet** — that is a separate
decision once the dataset above has been reviewed and a base model picked.
