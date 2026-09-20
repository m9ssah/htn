# Stage 2 content-model contract

Stage 1 is a **decision** pass. Jev receives app-owned atomic candidates and chooses only which candidate elements are present, their parent/slot placement, and their order. It produces a normal json-render flat `Spec`. It cannot write user-facing copy, invent data, select arbitrary components, create actions, or write CSS.

After a valid final Stage 1 spec exists, the server derives `jit.content.request.v1`. Stage 2 receives that request and returns exactly `jit.content.result.v1`.

## What Stage 2 writes

Only values listed in `targets[].fields`, keyed by the selected `elementId`. Typical examples are title text, body text, list-row labels, button labels, and slider endpoint names.

It must not return Markdown, prose outside the JSON object, element IDs not requested, undeclared fields, structural JSON, actions, state paths, CSS, HTML, component names, layout values, or theme values. Omit optional fields rather than using `null`.

Authoritative arithmetic, quantities, prices, slider ranges/values, URLs, progress, and toggle state stay in `fixed` or `sourceFacts`; never synthesize them.

## Training records

Use the exact production JSON request as the user message and the exact production result JSON as the assistant message. Do not train a different wrapper or a template ID. Validate every JSONL record with `validateContentResult` before it enters the corpus.

Cover every generated leaf kind, optional field, locale, minimum/maximum character limit, deterministic-fact combination, and rejection case. A result with an extra key or overlong string is invalid training data.
