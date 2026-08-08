#!/usr/bin/env node
/**
 * Runs the treatment run and the mutation control back to back and prints a
 * side-by-side comparison.
 *
 *   node test/run-all.mjs                    # extension  vs control
 *   node test/run-all.mjs selftest control   # harness fixture vs control
 *
 * The comparison is the point. A treatment run that passes on its own proves
 * nothing if the control passes too -- that would mean the assertions are
 * insensitive to the extension. This script says so in as many words.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, 'test', 'artifacts');

const treatment = process.argv[2] ?? 'extension';
const control = process.argv[3] ?? 'control';

function run(mode) {
  return new Promise((resolve) => {
    console.log(`\n\n${'#'.repeat(100)}\n### RUN: ${mode}\n${'#'.repeat(100)}\n`);
    const child = spawn(process.execPath, [path.join(ROOT, 'test', 'run-gate.mjs'), mode], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function load(mode) {
  const p = path.join(ARTIFACTS, `result-${mode}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

const codeT = await run(treatment);
const codeC = await run(control);

const t = load(treatment);
const c = load(control);

const cell = (v) => (v === undefined || v === null ? '-' : String(v));
const verdict = (res, id) => {
  const a = res?.verdicts?.list?.find((x) => x.id === id || x.id === `${id}-inv`);
  return a ? `${a.pass ? 'PASS' : 'FAIL'} (${a.id})` : '-';
};
const rows = [
  ['exit code', cell(codeT), cell(codeC)],
  ['browser / launch', cell(t?.launchMethod), cell(c?.launchMethod)],
  ['extension loaded', cell(t?.extensionLoaded), cell(c?.extensionLoaded)],
  ['/maps/vt/ requests', cell(t?.requests?.totalVtRequests), cell(c?.requests?.totalVtRequests)],
  ['base-map tiles (raw)', cell(t?.requests?.baseMapTileRequestsRaw), cell(c?.requests?.baseMapTileRequestsRaw)],
  ['base-map tiles (final)', cell(t?.requests?.baseMapTileRequestsTerminal), cell(c?.requests?.baseMapTileRequestsTerminal)],
  ['tokens (final)', JSON.stringify(t?.requests?.tokenCountsTerminal ?? null), JSON.stringify(c?.requests?.tokenCountsTerminal ?? null)],
  ['distinct zooms', JSON.stringify(t?.requests?.distinctZoomsTerminal ?? null), JSON.stringify(c?.requests?.distinctZoomsTerminal ?? null)],
  ['mean lum per phase', (t?.phases ?? []).map((p) => p.pixels.luminance).join(' '), (c?.phases ?? []).map((p) => p.pixels.luminance).join(' ')],
  ['A1', verdict(t, 'A1'), verdict(c, 'A1')],
  ['A2', verdict(t, 'A2'), verdict(c, 'A2')],
  ['A3', verdict(t, 'A3'), verdict(c, 'A3')],
  ['overall', t?.verdicts?.pass ? 'PASS' : 'FAIL', c?.verdicts?.pass ? 'PASS' : 'FAIL'],
];

const w0 = Math.max(...rows.map((r) => r[0].length), 'metric'.length);
const w1 = Math.max(...rows.map((r) => r[1].length), treatment.length, 40);
const w2 = Math.max(...rows.map((r) => r[2].length), control.length, 40);
const line = `+-${'-'.repeat(w0)}-+-${'-'.repeat(w1)}-+-${'-'.repeat(w2)}-+`;

console.log(`\n\n${'='.repeat(100)}`);
console.log('M0 GATE COMPARISON');
console.log('='.repeat(100));
console.log(line);
console.log(`| ${'metric'.padEnd(w0)} | ${treatment.padEnd(w1)} | ${control.padEnd(w2)} |`);
console.log(line);
for (const r of rows) console.log(`| ${r[0].padEnd(w0)} | ${r[1].padEnd(w1)} | ${r[2].padEnd(w2)} |`);
console.log(line);

const treatmentPassed = t?.verdicts?.pass === true;
const controlPassed = c?.verdicts?.pass === true;
const controlWouldPassPositive = c?.verdicts?.voidGate === true;

console.log('');
if (controlWouldPassPositive) {
  console.log('*** GATE VOID ***');
  console.log(
    'The control run satisfied the positive assertions A2 and A3 with no extension loaded.'
  );
  console.log('The assertions therefore do not measure the extension. No pass from this suite counts.');
} else if (treatmentPassed && controlPassed) {
  console.log('GATE: PASS. Treatment is dark and rewritten; control is light and unrewritten.');
  console.log('The assertions were shown to be capable of failing, so the pass is meaningful.');
} else {
  console.log('GATE: FAIL.');
  if (!treatmentPassed) console.log(`  treatment run "${treatment}" did not satisfy A1/A2/A3.`);
  if (!controlPassed) console.log(`  control run "${control}" did not satisfy the inverse assertions.`);
}
console.log(`\nartifacts: ${path.relative(ROOT, ARTIFACTS).replace(/\\/g, '/')}/`);

process.exit(controlWouldPassPositive || !treatmentPassed || !controlPassed ? 1 : 0);
