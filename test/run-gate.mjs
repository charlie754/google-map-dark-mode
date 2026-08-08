#!/usr/bin/env node
/**
 * Thin launcher: sets GATE_MODE and runs the Playwright test runner.
 *
 * It exists only because `GATE_MODE=x npx playwright test` is not portable to
 * PowerShell/cmd, and adding cross-env would break the "devDependencies limited
 * to @playwright/test and pngjs" constraint.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MODES = [
  'extension',
  'control',
  'selftest',
  'route-rewrite',
  'firefox-extension',
  'firefox-control',
  'firefox-selftest',
];

const mode = process.argv[2];
if (!mode || !MODES.includes(mode)) {
  console.error(`usage: node test/run-gate.mjs <${MODES.join('|')}>`);
  process.exit(2);
}

const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const child = spawn(
  process.execPath,
  [cli, 'test', ...process.argv.slice(3)],
  {
    cwd: ROOT,
    env: { ...process.env, GATE_MODE: mode },
    stdio: 'inherit',
  }
);
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
