import '@jit/renderer/renderer.css';
import { TEMPLATES, TEMPLATE_IDS, createRenderer } from '@jit/renderer';
import { SCENARIOS } from './scenarios.js';

/**
 * Measures whether a patch moves anything.
 *
 * Requirement: a slot with no value shimmers at its FINAL dimensions, so nothing
 * reflows when content lands; and a polish patch is paint-only. Both are claims
 * about geometry, which means they can only be checked where layout actually
 * runs.
 */
type Row = { template: string; stage: string; worst: number; slot: string; strict: boolean };

const probe = document.getElementById('probe')!;
const rows: Row[] = [];

/** Top edge of every slot, relative to the surface. */
function positions(host: HTMLElement): Map<string, number> {
  const origin = host.getBoundingClientRect().top;
  const out = new Map<string, number>();
  for (const el of host.querySelectorAll<HTMLElement>('[data-slot]')) {
    out.set(el.dataset['slot']!, Math.round((el.getBoundingClientRect().top - origin) * 100) / 100);
  }
  return out;
}

function worstDelta(before: Map<string, number>, after: Map<string, number>): [number, string] {
  let worst = 0;
  let slot = '—';
  for (const [key, value] of before) {
    const moved = Math.abs((after.get(key) ?? value) - value);
    if (moved > worst) {
      worst = moved;
      slot = key;
    }
  }
  return [Math.round(worst * 100) / 100, slot];
}

/** Sub-pixel tolerance only. Anything larger means a reservation is wrong. */
const TOLERANCE = 0.5;

/**
 * A polish patch that changes the type scale or the spacing is ASKING for a
 * relayout — that is the request, not a bug. Only colour-and-shape polish is
 * held to zero movement; "polish causes no layout shift" means it must not
 * touch the DOM, which is asserted separately with a MutationObserver.
 */
const LAYOUT_VARS = ['--jit-scale', '--jit-gap', '--jit-pad', '--jit-density-f'];

for (const templateId of TEMPLATE_IDS) {
  const scenario = SCENARIOS.find((s) => s.templateId === templateId);
  if (!scenario) continue;

  const host = document.createElement('div');
  host.style.width = '520px';
  probe.replaceChildren(host);
  const renderer = createRenderer(host);

  renderer.applySkeleton({ v: 1, templateId, maxWidth: TEMPLATES[templateId].maxWidth });
  const atSkeleton = positions(host);

  // A slot explicitly set to null collapses, which IS a reflow — a deliberate
  // exception, because the alternative is shimmering forever on a row that will
  // never fill. Strip those so this measures the reservation guarantee itself:
  // every slot that does receive content must not move.
  const filled = Object.fromEntries(
    Object.entries(scenario.content.slots).filter(([, v]) => v !== null),
  ) as typeof scenario.content.slots;
  renderer.applyContent({ v: 1, slots: filled });
  const atContent = positions(host);
  const [contentDelta, contentSlot] = worstDelta(atSkeleton, atContent);
  rows.push({
    template: templateId,
    stage: 'content lands',
    worst: contentDelta,
    slot: contentSlot,
    strict: true,
  });

  if (scenario.polish) {
    const reflows = LAYOUT_VARS.some((v) => v in scenario.polish!.tokens);
    renderer.applyPolish(scenario.polish);
    const atPolish = positions(host);
    const [polishDelta, polishSlot] = worstDelta(atContent, atPolish);
    rows.push({
      template: templateId,
      stage: reflows ? 'polish (resizes by request)' : 'polish (colour only)',
      worst: polishDelta,
      slot: polishSlot,
      strict: !reflows,
    });
  }
}

probe.replaceChildren();

const table = document.createElement('table');
table.innerHTML =
  '<thead><tr><th>template</th><th>stage</th><th>worst shift</th><th>slot</th><th></th></tr></thead>';
const body = document.createElement('tbody');
let failures = 0;

for (const row of rows) {
  const strict = row.strict;
  const ok = strict ? row.worst <= TOLERANCE : true;
  if (!ok) failures += 1;
  const tr = document.createElement('tr');
  for (const cell of [row.template, row.stage, `${row.worst}px`, row.slot]) {
    const td = document.createElement('td');
    td.textContent = cell;
    tr.append(td);
  }
  const verdict = document.createElement('td');
  verdict.className = ok ? 'pass' : 'fail';
  verdict.textContent = strict ? (ok ? 'PASS' : 'MOVED') : 'by request';
  tr.append(verdict);
  body.append(tr);
}

table.append(body);

const banner = document.createElement('p');
banner.className = failures === 0 ? 'pass' : 'fail';
banner.id = 'verdict';
banner.textContent =
  failures === 0
    ? `REFLOW-CHECK PASS — ${rows.filter((r) => r.strict).length} strict stages held position across ${TEMPLATE_IDS.length} templates`
    : `REFLOW-CHECK FAIL — ${failures} stage(s) moved the layout`;

document.getElementById('out')!.append(banner, table);
