# Adding a mock page

Mock pages are evaluated json-render examples, never template IDs. Add a
`SurfaceExample` beside `STUDY_SESSION_EXAMPLE` in
`packages/renderer/src/examples.ts`:

1. Define a flat `Spec` with only registered catalog types and explicit child IDs.
2. Bind model-written props to `/content/<element-id>/<field>` and seed each
   selected leaf as `pending` in `spec.state`.
3. Supply the corresponding `ContentUpdateV2`, theme, optional polish, and
   expected action bindings.
4. Add it to the device testbench and verify `npm test`, the reflow check, and
   the 800×480 preview.

The existing `study-session-planner` fixture is the reference implementation:
it uses a badge, text field, toggle, slider, and button without changing the
catalog, renderer, CSS, or device shell.
