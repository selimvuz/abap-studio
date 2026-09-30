import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_SETTINGS,
  MAX_SOURCE_BYTES,
  ProgramStore,
  normalizeProgramName,
  sanitizeSettings,
  validateSource,
} from '../apps/desktop/electron/storage';

let workspace: string;
let store: ProgramStore;
beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'abap-storage-test-'));
  store = new ProgramStore(workspace);
  await store.initialize();
});
afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe('plain-file program workspace', () => {
  it('seeds both executable milestones, then persists source and recent programs', async () => {
    expect((await store.listPrograms()).map((program) => program.name)).toEqual([
      'ZHELLO_WORLD',
      'ZINTERNAL_TABLE',
    ]);
    const saved = await store.saveProgram('ztest.abap', 'REPORT ztest.\nWRITE `Saved`.');
    expect(saved.name).toBe('ZTEST');
    expect(await fs.readFile(path.join(workspace, 'programs', 'ZTEST.abap'), 'utf8')).toBe(
      saved.source,
    );
    const reopened = new ProgramStore(workspace);
    await reopened.initialize();
    expect(await reopened.readProgram('ZTEST')).toEqual(saved);
    expect(reopened.getSettings().recent[0]).toBe('ZTEST');
  });

  it('renames and deletes without overwriting a different report', async () => {
    await store.saveProgram('ZA', 'WRITE `A`.');
    await store.saveProgram('ZB', 'WRITE `B`.');
    await expect(store.renameProgram('ZA', 'ZB')).rejects.toThrow('already exists');
    expect((await store.readProgram('ZA')).source).toBe('WRITE `A`.');
    expect((await store.readProgram('ZB')).source).toBe('WRITE `B`.');
    const renamed = await store.renameProgram('ZA', 'ZC');
    expect(renamed.source).toBe('WRITE `A`.');
    await expect(store.readProgram('ZA')).rejects.toThrow();
    await store.deleteProgram('ZC');
    await expect(store.readProgram('ZC')).rejects.toThrow();
    expect(store.getSettings().recent).not.toContain('ZC');
  });

  it('does not recreate deliberately deleted starter programs on restart', async () => {
    await store.deleteProgram('ZHELLO_WORLD');
    const reopened = new ProgramStore(workspace);
    await reopened.initialize();
    expect((await reopened.listPrograms()).map((program) => program.name)).not.toContain(
      'ZHELLO_WORLD',
    );
  });

  it('rejects traversal, device path syntax, oversized data, and null bytes', async () => {
    for (const name of [
      '../EVIL',
      'C:\\evil',
      '/tmp/file',
      '..',
      'A/B',
      'A\\B',
      '',
      'CON',
      'COM1',
      'A'.repeat(41),
    ]) {
      expect(() => normalizeProgramName(name)).toThrow();
      await expect(store.saveProgram(name, 'WRITE `No`.')).rejects.toThrow();
    }
    expect(normalizeProgramName(' zreport.abap ')).toBe('ZREPORT');
    expect(() => validateSource('\0')).toThrow();
    await expect(store.saveProgram('ZBIG', 'x'.repeat(MAX_SOURCE_BYTES + 1))).rejects.toThrow(
      '1 MB',
    );
    expect(
      (await fs.readdir(path.join(workspace, 'programs'))).every((file) => file.endsWith('.abap')),
    ).toBe(true);
  });

  it('exclusive import creation protects an existing source file', async () => {
    await store.saveProgram('ZREPORT', 'WRITE `Original`.');
    await expect(store.saveProgram('ZREPORT', 'WRITE `Replacement`.', true)).rejects.toThrow();
    expect((await store.readProgram('ZREPORT')).source).toBe('WRITE `Original`.');
  });

  it('does not read or overwrite a symlinked report', async (context) => {
    const target = path.join(workspace, 'protected.abap');
    await fs.writeFile(target, 'WRITE `Protected`.');
    const link = path.join(workspace, 'programs', 'ZLINK.abap');
    try {
      await fs.symlink(target, link, 'file');
    } catch (error) {
      if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        context.skip();
        return;
      }
      throw error;
    }
    await expect(store.readProgram('ZLINK')).rejects.toThrow('Symbolic links');
    await expect(store.saveProgram('ZLINK', 'WRITE `Changed`.')).rejects.toThrow('Symbolic links');
    await expect(store.deleteProgram('ZLINK')).rejects.toThrow('Symbolic links');
    expect(await fs.readFile(target, 'utf8')).toBe('WRITE `Protected`.');
  });

  it('rejects a directory masquerading as an ABAP file', async () => {
    await fs.mkdir(path.join(workspace, 'programs', 'ZDIRECTORY.abap'));
    await expect(store.saveProgram('ZDIRECTORY', 'WRITE 1.')).rejects.toThrow('non-file');
    expect((await store.listPrograms()).map((program) => program.name)).not.toContain('ZDIRECTORY');
  });

  it('recovers invalid settings without losing programs', async () => {
    await fs.writeFile(path.join(workspace, 'settings.json'), '{invalid');
    const reopened = new ProgramStore(workspace);
    await reopened.initialize();
    expect(reopened.getSettings().theme).toBe('dark');
    expect(await reopened.listPrograms()).toHaveLength(2);
  });

  it('validates settings and serializes concurrent updates to the latest state', async () => {
    expect(
      sanitizeSettings({
        timeoutMs: -1,
        maxStatements: Infinity,
        memoryLimitMb: 9999,
        theme: 'unknown',
        recent: ['../../a', 'ZVALID', 'ZVALID'],
      }),
    ).toMatchObject({
      timeoutMs: 100,
      maxStatements: DEFAULT_SETTINGS.maxStatements,
      memoryLimitMb: 512,
      theme: 'dark',
      recent: ['ZVALID'],
    });
    await Promise.all([
      store.updateSettings({ fontSize: 12 }),
      store.updateSettings({ fontSize: 18, theme: 'light' }),
    ]);
    const persisted = JSON.parse(await fs.readFile(path.join(workspace, 'settings.json'), 'utf8'));
    expect(persisted.fontSize).toBe(18);
    expect(persisted.theme).toBe('light');
    expect((await fs.readdir(workspace)).filter((file) => file.endsWith('.tmp'))).toHaveLength(0);
  });
});
