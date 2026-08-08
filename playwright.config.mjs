import { defineConfig } from '@playwright/test';

/**
 * The M0 gate drives a live third-party site with real pointer gestures, so:
 *  - one worker, never parallel (two headed Chromes fighting for focus is noise,
 *    and hammering Google is off the table);
 *  - zero retries, because a retry would quietly average away a real failure;
 *  - a long per-test timeout: five gesture phases each with a settle window.
 *
 * The browser is launched inside the test via launchPersistentContext -- an
 * unpacked MV3 extension cannot be loaded through the `use` fixtures -- so
 * `projects` deliberately declares no browser.
 */
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 6 * 60 * 1000,
  expect: { timeout: 15 * 1000 },
  reporter: [['list', { printSteps: false }]],
  outputDir: './test/artifacts/pw-output',
  use: {
    actionTimeout: 30 * 1000,
    navigationTimeout: 90 * 1000,
  },
});
