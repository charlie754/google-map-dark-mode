import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT_SOURCE = path.join(ROOT, 'test', 'banner', 'client');
const LIB_SOURCE = path.join(ROOT, 'extension', 'lib');
const VECTORS_SOURCE = path.join(ROOT, 'test', 'banner', 'vectors');

const copyFixture = (mutateCore = false) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goatcam-banner-vectors-'));
  const client = path.join(temp, 'client');
  const vectors = path.join(temp, 'vectors');
  fs.mkdirSync(client);
  fs.cpSync(VECTORS_SOURCE, vectors, { recursive: true });
  for (const file of ['banner-core.js', 'banner-machine.js']) {
    let bytes = fs.readFileSync(path.join(LIB_SOURCE, file));
    if (mutateCore && file === 'banner-core.js') {
      const source = bytes.toString('utf8');
      const mutated = source.replace('const MAX_FILE_BYTES = 16384;', 'const MAX_FILE_BYTES = 16385;');
      assert.notEqual(mutated, source, 'negative control mutation marker was not found');
      bytes = Buffer.from(mutated, 'utf8');
    }
    fs.writeFileSync(path.join(client, file), bytes);
  }
  for (const file of ['banner-core.test.mjs', 'banner-machine.test.mjs']) {
    fs.copyFileSync(path.join(CLIENT_SOURCE, file), path.join(client, file));
  }
  return temp;
};

const runCopiedSuite = (temp) => spawnSync(
  process.execPath,
  ['--test', '--test-reporter=spec', 'client/banner-core.test.mjs', 'client/banner-machine.test.mjs'],
  {
    cwd: temp,
    encoding: 'utf8',
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
  },
);

const passingLine = (output, name) => output.split(/\r?\n/).some(
  (line) => line.includes('✔') && line.includes(name),
);

test('copied banner vectors run the complete healthy client suite', () => {
  const temp = copyFixture();
  const result = runCopiedSuite(temp);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /tests\s+151/);
  assert.match(output, /pass\s+151/);
  assert.match(output, /fail\s+0/);

  const cases = JSON.parse(fs.readFileSync(path.join(temp, 'vectors', 'cases.json'), 'utf8'));
  const transitions = JSON.parse(fs.readFileSync(path.join(temp, 'vectors', 'transitions.json'), 'utf8'));
  for (const entry of cases.cases) assert.equal(passingLine(output, entry.name), true, `case ${entry.name}`);
  for (const entry of transitions.scenarios) {
    assert.equal(passingLine(output, entry.name), true, `scenario ${entry.name}`);
  }
});

test('mutating one core limit token makes the copied suite fail', () => {
  const temp = copyFixture(true);
  const result = runCopiedSuite(temp);
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
