import assert from 'node:assert/strict';
import { launchDesktop } from './electron-session.mjs';
import electronPath from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workspace = resolve('.work', `smoke-${Date.now()}`);
await mkdir(resolve(workspace, '.electron'), { recursive: true });
await mkdir('docs/screenshots', { recursive: true });
const packaged = process.env.ABAP_STUDIO_EXECUTABLE;
const env = {
  ...process.env,
  ABAP_STUDIO_TEST: '1',
  ABAP_STUDIO_HIDDEN: '1',
  ABAP_STUDIO_WORKSPACE: workspace,
};
delete env.ELECTRON_RUN_AS_NODE;
const application = await launchDesktop(packaged || electronPath, packaged ? [] : ['.'], env);
const page = application.page;
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const checks = [];
const record = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};

try {
  await page.waitForSelector('[data-testid="code-editor"]', { timeout: 30000 });
  await page.waitForSelector('.monaco-editor textarea', { timeout: 15000 });
  const mainSource = await readFile('apps/desktop/electron/main.ts', 'utf8');
  assert.match(
    mainSource,
    /contextIsolation:\s*true,\s*nodeIntegration:\s*false,\s*sandbox:\s*true/,
  );
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  record('Secure window configuration and renderer without Node access');

  const boot = await page.evaluate(() => window.desktop.bootstrap());
  assert.ok(boot.programs.some((p) => p.name === 'ZHELLO_WORLD'));
  const hello = 'REPORT zhello_world.\n\nDATA(lv_name) = `World`.\n\nWRITE |Hello { lv_name }|.';
  const checked = await page.evaluate((source) => window.desktop.check(source), hello);
  assert.deepEqual(checked.diagnostics, []);
  record('Milestone 1 syntax check');

  const edit = async (source) => {
    await page.locator('.monaco-editor textarea').first().focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(source);
  };
  await edit(hello);
  await page.keyboard.press('F8');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="output-text"]')?.textContent === 'Hello World',
  );
  record('Actual Monaco → F8 → interpreter → Hello World output');
  await page.keyboard.press('Control+S');
  await page.waitForFunction(
    async (source) =>
      (await window.desktop.listPrograms()).find((p) => p.name === 'ZHELLO_WORLD')?.source ===
      source,
    hello,
  );
  assert.equal(await readFile(resolve(workspace, 'programs/ZHELLO_WORLD.abap'), 'utf8'), hello);
  record('Explicit save persists plain ABAP source');

  const execute = async (source, options = {}) =>
    page.evaluate(
      async ({ source, options }) => {
        return await new Promise(async (resolve, reject) => {
          const off = window.desktop.onRuntime((event) => {
            if (['completed', 'error', 'stopped'].includes(event.type)) {
              off();
              resolve(event);
            }
          });
          try {
            await window.desktop.run({ source, name: 'ZSMOKE', ...options });
          } catch (error) {
            off();
            reject(error);
          }
        });
      },
      { source, options },
    );

  const table = boot.programs.find((p) => p.name === 'ZINTERNAL_TABLE').source;
  assert.deepEqual(
    (await page.evaluate((source) => window.desktop.check(source), table)).diagnostics,
    [],
  );
  const tableResult = await execute(table);
  assert.equal(tableResult.type, 'completed');
  assert.equal(tableResult.output, 'Alice 30\nBob 25');
  record('Milestone 2 structure VALUE + LOOP internal table output');

  const invalid = 'REPORT zbad.\nWRITE lv_missing.';
  const diagnostics = await page.evaluate((source) => window.desktop.check(source), invalid);
  assert.ok(
    diagnostics.diagnostics.some(
      (d) => d.severity === 'error' && d.line === 2 && /LV_MISSING/i.test(d.message),
    ),
  );
  record('Located unknown-variable diagnostic');

  await page.evaluate(() => window.desktop.updateSettings({ maxStatements: 100, timeoutMs: 2000 }));
  const infinite = await execute('REPORT zloop. DO. ENDDO.');
  assert.equal(infinite.type, 'error');
  assert.match(infinite.message, /limit|budget|statements/i);
  assert.equal((await execute(hello)).output, 'Hello World');
  record('Empty infinite-loop statement budget and clean restart');

  await page.evaluate(() =>
    window.desktop.updateSettings({ maxStatements: 10_000_000, timeoutMs: 120000 }),
  );
  const stopResult = await page.evaluate(
    async () =>
      new Promise(async (resolve, reject) => {
        const off = window.desktop.onRuntime((event) => {
          if (['stopped', 'error'].includes(event.type)) {
            off();
            resolve(event);
          }
        });
        try {
          await window.desktop.run({ source: 'REPORT zloop. DO. ENDDO.', name: 'ZLOOP' });
          await window.desktop.stop();
        } catch (error) {
          off();
          reject(error);
        }
      }),
  );
  assert.equal(stopResult.type, 'stopped');
  assert.equal(await page.evaluate(() => 2 + 2), 4);
  record('Stop terminates worker while renderer stays responsive');

  const debugResult = await page.evaluate(
    async () =>
      new Promise(async (resolve, reject) => {
        const pauses = [];
        const off = window.desktop.onRuntime((event) => {
          if (event.type === 'paused') {
            pauses.push(event.snapshot);
            void window.desktop.debug(pauses.length < 3 ? 'stepOver' : 'continue');
          }
          if (event.type === 'completed' || event.type === 'error') {
            off();
            resolve({ event, pauses });
          }
        });
        try {
          await window.desktop.run({
            source: 'REPORT zdebug.\nDATA(lv_count) = 5.\nWRITE lv_count.',
            name: 'ZDEBUG',
            debug: true,
          });
        } catch (error) {
          off();
          reject(error);
        }
      }),
  );
  assert.equal(debugResult.event.type, 'completed');
  assert.equal(debugResult.event.output, '5');
  assert.ok(debugResult.pauses.length >= 2);
  assert.ok(
    debugResult.pauses.some((s) => s.variables.some((v) => v.name === 'LV_COUNT' && v.value === 5)),
  );
  record('Debugger pauses, steps, exposes typed variables, and continues');

  // Restore the ordinary editor workflow for the screenshot and verify both themes.
  await page.evaluate(() =>
    window.desktop.updateSettings({ maxStatements: 100000, timeoutMs: 10000 }),
  );
  await page.getByRole('button', { name: 'Open ZINTERNAL_TABLE', exact: true }).click();
  await page.keyboard.press('F8');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="output-text"]')?.textContent === 'Alice 30\nBob 25',
  );
  await page.screenshot({ path: 'docs/screenshots/dark.png' });
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.theme === 'light' ||
      document.body.dataset.theme === 'light' ||
      !!document.querySelector('[data-theme="light"]'),
  );
  await page.screenshot({ path: 'docs/screenshots/light.png' });
  record('Dark and light editor rendering');
  assert.deepEqual(errors, [], 'Renderer must not produce uncaught errors');
  record('No uncaught renderer exceptions');
  await writeFile(
    'docs/SMOKE-RESULTS.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        packaged: !!packaged,
        chromiumSandboxDisabledForTest: env.ABAP_STUDIO_TEST_NO_CHROMIUM_SANDBOX === '1',
        checks,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`${checks.length} desktop checks passed.`);
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/failure.png' }).catch(() => undefined);
  console.error(application.logs());
  throw error;
} finally {
  await application.close();
}
