import assert from 'node:assert/strict';
import electronPath from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchDesktop } from './electron-session.mjs';

const workspace = resolve('.work', `ui-smoke-${Date.now()}`);
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
page.setDefaultTimeout(15000);
const errors = [],
  checks = [];
page.on('pageerror', (error) => errors.push(error.message));
const record = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};
const program = (name) => page.getByRole('button', { name: `Open ${name}`, exact: true });
const edit = async (source) => {
  await page.locator('.monaco-editor textarea').first().focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
};
const waitSaved = async (name, source) => {
  await page.waitForFunction(
    async ({ name, source }) =>
      (await window.desktop.listPrograms()).find((p) => p.name === name)?.source === source,
    { name, source },
  );
  assert.equal(await readFile(resolve(workspace, 'programs', `${name}.abap`), 'utf8'), source);
};
const programMenu = async (name, action) => {
  await program(name).hover();
  await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
};
const nameDialog = async (title, name, submit) => {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog.waitFor();
  await dialog.getByLabel('Program name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: submit, exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
};

try {
  await page.waitForSelector('[data-testid="code-editor"]', { timeout: 30000 });
  await page.waitForSelector('.monaco-editor textarea');
  await page.getByRole('button', { name: 'New program', exact: true }).click();
  await nameDialog('New program', 'ZUI_FLOW', 'Create program');
  await program('ZUI_FLOW').waitFor();
  const source = 'REPORT zui_flow.\nDATA(lv_name) = `Workspace`.\nWRITE |Hello { lv_name }|.';
  await edit(source);
  await page.keyboard.press('Control+S');
  await waitSaved('ZUI_FLOW', source);
  record('New Program dialog and explicit Save write a workspace .abap file');

  await page.keyboard.press('Control+Shift+S');
  await nameDialog('Save program as', 'ZUI_COPY', 'Save program');
  await waitSaved('ZUI_COPY', source);
  assert.equal(await program('ZUI_FLOW').count(), 1);
  record('Save As creates a separate report and preserves the original');

  await programMenu('ZUI_COPY', 'Rename…');
  await nameDialog('Rename program', 'ZUI_RENAMED', 'Rename');
  await program('ZUI_RENAMED').waitFor();
  assert.equal(await program('ZUI_COPY').count(), 0);
  await waitSaved('ZUI_RENAMED', source);
  record('Rename updates the program list, active document and stored file');

  await programMenu('ZUI_RENAMED', 'Duplicate…');
  await nameDialog('Duplicate program', 'ZUI_DUPLICATE', 'Save program');
  await waitSaved('ZUI_DUPLICATE', source);
  await program('ZUI_RENAMED').waitFor();
  await programMenu('ZUI_DUPLICATE', 'Delete');
  const deleteDialog = page.getByRole('dialog', { name: 'Delete program?', exact: true });
  await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await program('ZUI_DUPLICATE').waitFor();
  await programMenu('ZUI_DUPLICATE', 'Delete');
  await deleteDialog.getByRole('button', { name: 'Delete program', exact: true }).click();
  await program('ZUI_DUPLICATE').waitFor({ state: 'hidden' });
  await assert.rejects(
    readFile(resolve(workspace, 'programs/ZUI_DUPLICATE.abap'), 'utf8'),
    /ENOENT/,
  );
  record('Duplicate preserves source; Delete requires confirmation and removes the file');

  await program('ZUI_RENAMED').click();
  const changed = 'REPORT zui_renamed.\nWRITE `Saved before close`.';
  await edit(changed);
  await page.getByRole('button', { name: 'Close ZUI_RENAMED', exact: true }).click();
  const unsaved = page.getByRole('dialog', { name: 'Unsaved changes', exact: true });
  await unsaved.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Close ZUI_RENAMED', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close ZUI_RENAMED', exact: true }).click();
  await unsaved.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page
    .getByRole('button', { name: 'Close ZUI_RENAMED', exact: true })
    .waitFor({ state: 'hidden' });
  await waitSaved('ZUI_RENAMED', changed);
  await program('ZUI_RENAMED').click();
  await edit('REPORT zui_renamed.\nWRITE `Discard this draft`.');
  await page.getByRole('button', { name: 'Close ZUI_RENAMED', exact: true }).click();
  await unsaved.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page
    .getByRole('button', { name: 'Close ZUI_RENAMED', exact: true })
    .waitFor({ state: 'hidden' });
  assert.equal(await readFile(resolve(workspace, 'programs/ZUI_RENAMED.abap'), 'utf8'), changed);
  record('Dirty Close supports Cancel, Save changes, and Discard without silent data loss');

  await page.keyboard.press('Control+P');
  const quickOpen = page.getByRole('dialog', { name: 'Quick open', exact: true });
  await quickOpen.getByRole('textbox', { name: 'Search programs' }).fill('ZUI_FLOW');
  await page.keyboard.press('Enter');
  await quickOpen.waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () =>
      document.querySelector('.program-row.active [data-program]')?.getAttribute('data-program') ===
      'ZUI_FLOW',
  );
  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('textbox', { name: 'Search commands' }).fill('Format document');
  await page.keyboard.press('Enter');
  await palette.waitFor({ state: 'hidden' });
  await page.getByRole('status').filter({ hasText: 'Document formatted.' }).waitFor();
  record('Ctrl P quick-open and Ctrl Shift P command palette execute real editor actions');

  await edit('REPORT zui_flow.\nWRITE lv_missing.');
  await page.getByTestId('check-button').click();
  const problems = page.getByTestId('problems');
  await problems
    .getByRole('button')
    .filter({ hasText: /LV_MISSING/i })
    .waitFor();
  await page.locator('.squiggly-error').first().waitFor();
  await problems
    .getByRole('button')
    .filter({ hasText: /LV_MISSING/i })
    .click();
  assert.match(await page.locator('.status-bar').textContent(), /Ln 2, Col/);
  record('Check displays a located Problems diagnostic, Monaco error marker and line navigation');

  const parameters =
    'REPORT zui_flow.\nPARAMETERS p_name TYPE string DEFAULT `World`.\nWRITE |Hello { p_name }|.';
  await edit(parameters);
  await page.keyboard.press('F8');
  const runDialog = page.getByRole('dialog', { name: 'Run ZUI_FLOW', exact: true });
  await runDialog.waitFor();
  const parameterInput = runDialog.locator('.parameter-field input');
  assert.equal(await parameterInput.inputValue(), 'World');
  await parameterInput.fill('Desktop');
  await runDialog.getByRole('button', { name: 'Run program', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="output-text"]')?.textContent === 'Hello Desktop',
  );
  record('F8 parameter dialog supplies defaults and entered values to the interpreter');

  await page.keyboard.press('Control+S');
  await waitSaved('ZUI_FLOW', parameters);
  assert.deepEqual(errors, [], 'Renderer must not produce uncaught exceptions');
  record('No uncaught renderer exceptions through program-management workflows');
  await writeFile(
    'docs/UI-SMOKE-RESULTS.json',
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
  console.log(`${checks.length} desktop UI checks passed.`);
} catch (error) {
  await page.screenshot({ path: 'docs/screenshots/ui-failure.png' }).catch(() => undefined);
  console.error(application.logs());
  throw error;
} finally {
  await application.close();
}
