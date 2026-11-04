import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(clientDir, '..', 'vectors');
const machinePath = path.join(clientDir, 'banner-machine.js');
const machineSource = fs.readFileSync(machinePath, 'utf8');
const transitions = JSON.parse(
  fs.readFileSync(path.join(vectorsDir, 'transitions.json'), 'utf8'),
);

let machineApiPromise;
const loadMachineApi = async () => {
  if (!machineApiPromise) {
    machineApiPromise = import(pathToFileURL(machinePath).href).then(
      () => globalThis.GoatBannerMachine,
    );
  }
  return machineApiPromise;
};

const forbiddenWhileHidden = new Set([
  'fetch-signed',
  'fetch-photos',
  'write-set',
  'write-record',
  'arm-timer',
  'display',
]);

test('transitions.json contains scenarios', () => {
  assert.ok(
    Array.isArray(transitions.scenarios) && transitions.scenarios.length > 0,
    'transitions.json must contain at least one scenario',
  );
});

test('classic script exposes the same global and module API', () => {
  const emptyContext = {};
  vm.runInNewContext(machineSource, emptyContext);
  assert.ok(emptyContext.GoatBannerMachine);

  const moduleContext = { module: { exports: {} } };
  vm.runInNewContext(machineSource, moduleContext);
  assert.strictEqual(moduleContext.module.exports, moduleContext.GoatBannerMachine);
});

test('START treats undefined records as empty and stages failures atomically', async () => {
  const api = await loadMachineApi();
  const machine = api.create({ floor: 8, kinds: ['webp'] });
  assert.deepStrictEqual(
    machine.dispatch({ type: 'START', setValid: false }, 1793620800000),
    [{ type: 'delete-unnamed-sets' }],
  );
  assert.deepStrictEqual(machine.state().record, {
    hwm: 8,
    current: null,
    lastCheckMs: 0,
    failures: 0,
  });

  const before = machine.state();
  const brokenRecord = {};
  Object.defineProperty(brokenRecord, 'hwm', {
    enumerable: true,
    get() {
      throw new Error('broken record');
    },
  });
  assert.deepStrictEqual(
    machine.dispatch({ type: 'START', record: brokenRecord, setValid: false }, 1793620801000),
    [],
  );
  assert.deepStrictEqual(machine.state(), before);
});

test('machine copies caller-owned records, effects, and kinds', async () => {
  const api = await loadMachineApi();
  const kinds = ['webp'];
  const machine = api.create({ floor: 1, kinds });
  kinds[0] = 'jpg';

  machine.dispatch({ type: 'START', record: null, setValid: false }, 1793620800000);
  const returnedState = machine.state();
  returnedState.record.hwm = 999;
  assert.equal(machine.state().record.hwm, 1);

  const shownEffects = machine.dispatch(
    { type: 'SHOWN', mayFetch: true },
    1793620800000,
  );
  assert.deepStrictEqual(shownEffects, [
    { type: 'display', what: 'dagoat', immediate: true },
    { type: 'fetch-signed', gen: 1 },
  ]);

  const failedEffects = machine.dispatch(
    { type: 'FAILED', gen: 1 },
    1793620801000,
  );
  failedEffects[0].record.failures = 999;
  assert.equal(machine.state().record.failures, 1);

  machine.dispatch({ type: 'HIDDEN' }, 1793642402000);
  machine.dispatch({ type: 'SHOWN', mayFetch: true }, 1793642402000);
  const photoEffects = machine.dispatch(
    {
      type: 'SIGNED',
      gen: 2,
      result: {
        action: 'show',
        reason: null,
        revision: 2,
        sha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        banner: {
          expires: '2026-11-05T12:00:00Z',
          photo: {
            sha256: {
              webp: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              jpg: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
            },
          },
        },
      },
    },
    1793642403000,
  );
  assert.deepStrictEqual(photoEffects, [
    { type: 'fetch-photos', gen: 2, kinds: ['webp'] },
  ]);
});

test('negative control reports a broken hwm commit', () => {
  const brokenSource = machineSource.replace(
    ' || result.revision < record.hwm',
    '',
  );
  assert.notStrictEqual(brokenSource, machineSource);
  const context = {};
  vm.runInNewContext(brokenSource, context);
  const machine = context.GoatBannerMachine.create({ floor: 1, kinds: ['webp'] });
  const futureRecord = {
    hwm: 5,
    current: {
      revision: 5,
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      enabled: true,
      expiresMs: 1793880000000,
      photos: { webp: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    },
    lastCheckMs: 0,
    failures: 0,
  };
  machine.dispatch(
    { type: 'START', record: futureRecord, setValid: true },
    1793620800000,
  );
  machine.dispatch({ type: 'SHOWN', mayFetch: true }, 1793620800000);
  machine.dispatch(
    {
      type: 'SIGNED',
      gen: 1,
      result: {
        action: 'show',
        reason: null,
        revision: 4,
        sha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        banner: {
          expires: '2026-11-05T12:00:00Z',
          photo: {
            sha256: {
              webp: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            },
          },
        },
      },
    },
    1793620800500,
  );
  machine.dispatch({ type: 'PHOTOS', gen: 1, ok: true }, 1793620800600);
  machine.dispatch({ type: 'COMMITTED', gen: 1 }, 1793620802000);
  assert.ok(machine.checkInvariants().length > 0);
});

for (const scenario of transitions.scenarios ?? []) {
  test(scenario.name, async () => {
    const api = await loadMachineApi();
    assert.ok(api, `${scenario.name}: GoatBannerMachine was not exposed`);
    const machine = api.create({ floor: scenario.floor, kinds: scenario.kinds });

    for (const [stepIndex, step] of scenario.steps.entries()) {
      const visibleBefore = machine.state().visible;
      const effects = machine.dispatch(step.event, step.atMs);

      assert.deepStrictEqual(
        effects,
        step.expect,
        `${scenario.name} step ${stepIndex}: effects`,
      );

      const state = machine.state();
      if (step.state) {
        for (const [key, expected] of Object.entries(step.state)) {
          assert.deepStrictEqual(
            state[key],
            expected,
            `${scenario.name} step ${stepIndex}: state.${key}`,
          );
        }
      }

      assert.deepStrictEqual(
        machine.checkInvariants(),
        [],
        `${scenario.name} step ${stepIndex}: invariants`,
      );

      if (
        step.event.type !== 'START'
        && !visibleBefore
        && !state.visible
      ) {
        assert.equal(
          effects.some((effect) => forbiddenWhileHidden.has(effect.type)),
          false,
          `${scenario.name} step ${stepIndex}: hidden event emitted a forbidden effect`,
        );
      }
    }
  });
}
