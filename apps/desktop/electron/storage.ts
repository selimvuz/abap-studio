import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProgramFile, Settings } from '../../../packages/shared/src/index';

export const MAX_SOURCE_BYTES = 1_048_576;
export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  fontSize: 14,
  minimap: false,
  timeoutMs: 10_000,
  maxStatements: 100_000,
  memoryLimitMb: 128,
  recent: [],
  lastProgram: 'ZHELLO_WORLD',
};

export const EXAMPLES: Record<string, string> = {
  ZHELLO_WORLD:
    'REPORT zhello_world.\n\n" Your first ABAP report. Press F8 to run.\nDATA(lv_name) = `World`.\n\nWRITE |Hello { lv_name }|.\n',
  ZINTERNAL_TABLE:
    'REPORT zinternal_table.\n\nTYPES:\n  BEGIN OF ty_person,\n    name TYPE string,\n    age  TYPE i,\n  END OF ty_person.\n\nTYPES ty_people TYPE STANDARD TABLE OF ty_person WITH EMPTY KEY.\n\nDATA(lt_people) = VALUE ty_people(\n  ( name = `Alice` age = 30 )\n  ( name = `Bob`   age = 25 )\n).\n\nLOOP AT lt_people INTO DATA(ls_person).\n  WRITE: / ls_person-name, ls_person-age.\nENDLOOP.\n',
};

export function normalizeProgramName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A program name is required.');
  const name = value
    .trim()
    .replace(/\.abap$/i, '')
    .toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(name)) {
    throw new Error('Use 1–40 letters, numbers, or underscores, starting with a letter.');
  }
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(name))
    throw new Error('This name is reserved by Windows. Choose another program name.');
  return name;
}

export function validateSource(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Program source must be text.');
  if (Buffer.byteLength(value, 'utf8') > MAX_SOURCE_BYTES)
    throw new Error('Programs must be smaller than 1 MB.');
  if (value.includes('\0')) throw new Error('Program source cannot contain null bytes.');
  return value;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

export function sanitizeSettings(input: unknown, previous: Settings = DEFAULT_SETTINGS): Settings {
  const data =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const recent = Array.isArray(data.recent)
    ? [
        ...new Set(
          data.recent.filter(
            (name): name is string =>
              typeof name === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(name),
          ),
        ),
      ].slice(0, 12)
    : previous.recent;
  const lastProgram =
    typeof data.lastProgram === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(data.lastProgram)
      ? data.lastProgram
      : previous.lastProgram;
  return {
    theme: data.theme === 'light' || data.theme === 'dark' ? data.theme : previous.theme,
    fontSize: boundedNumber(data.fontSize, previous.fontSize, 11, 24),
    minimap: typeof data.minimap === 'boolean' ? data.minimap : previous.minimap,
    timeoutMs: boundedNumber(data.timeoutMs, previous.timeoutMs, 100, 120_000),
    maxStatements: boundedNumber(data.maxStatements, previous.maxStatements, 100, 10_000_000),
    memoryLimitMb: boundedNumber(data.memoryLimitMb, previous.memoryLimitMb, 64, 512),
    recent,
    lastProgram,
  };
}

/** Only validated program identifiers cross this boundary; renderer paths never do. */
export class ProgramStore {
  readonly programsPath: string;
  private settings: Settings = { ...DEFAULT_SETTINGS, recent: [] };
  private settingsQueue: Promise<unknown> = Promise.resolve();

  constructor(readonly workspacePath: string) {
    this.programsPath = path.join(workspacePath, 'programs');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.programsPath, { recursive: true });
    const directory = await fs.lstat(this.programsPath);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error('The programs directory must be a local directory.');
    let firstLaunch = false;
    try {
      const info = await fs.lstat(this.settingsPath());
      if (info.isSymbolicLink() || !info.isFile() || info.size > 100_000)
        throw new Error('Invalid settings file.');
      this.settings = sanitizeSettings(JSON.parse(await fs.readFile(this.settingsPath(), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') firstLaunch = true;
      // Corrupt settings do not prevent recovery of the user's source files.
      this.settings = { ...DEFAULT_SETTINGS, recent: [] };
    }
    if (firstLaunch) {
      for (const [name, source] of Object.entries(EXAMPLES)) {
        try {
          await fs.writeFile(this.programPath(name), source, { flag: 'wx', encoding: 'utf8' });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      }
      await this.updateSettings(this.settings);
    }
  }

  getSettings(): Settings {
    return { ...this.settings, recent: [...this.settings.recent] };
  }

  async updateSettings(patch: unknown): Promise<Settings> {
    const next = sanitizeSettings(patch, this.settings);
    this.settings = next;
    // Serialize writes so slower earlier requests cannot overwrite newer settings.
    this.settingsQueue = this.settingsQueue
      .catch(() => undefined)
      .then(() => this.atomicWrite(this.settingsPath(), JSON.stringify(next, null, 2) + '\n'));
    await this.settingsQueue;
    return this.getSettings();
  }

  async listPrograms(): Promise<ProgramFile[]> {
    const entries = await fs.readdir(this.programsPath, { withFileTypes: true });
    const programs: ProgramFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^[A-Z][A-Z0-9_]{0,39}\.abap$/.test(entry.name)) continue;
      try {
        programs.push(await this.readProgram(entry.name));
      } catch {
        /* One inaccessible or oversized file must not hide the workspace. */
      }
    }
    return programs.sort((a, b) => a.name.localeCompare(b.name));
  }

  async readProgram(value: unknown): Promise<ProgramFile> {
    const name = normalizeProgramName(value);
    const filePath = this.programPath(name);
    const stat = await this.regularFile(filePath);
    if (stat.size > MAX_SOURCE_BYTES) throw new Error('Programs must be smaller than 1 MB.');
    return {
      name,
      source: validateSource(await fs.readFile(filePath, 'utf8')),
      updatedAt: stat.mtime.toISOString(),
    };
  }

  async saveProgram(value: unknown, sourceValue: unknown, exclusive = false): Promise<ProgramFile> {
    const name = normalizeProgramName(value);
    const source = validateSource(sourceValue);
    const filePath = this.programPath(name);
    if (exclusive) await fs.writeFile(filePath, source, { flag: 'wx', encoding: 'utf8' });
    else await this.atomicWrite(filePath, source);
    await this.touchRecent(name);
    return this.readProgram(name);
  }

  async renameProgram(oldValue: unknown, newValue: unknown): Promise<ProgramFile> {
    const oldName = normalizeProgramName(oldValue);
    const newName = normalizeProgramName(newValue);
    if (oldName === newName) return this.readProgram(oldName);
    await this.regularFile(this.programPath(oldName));
    try {
      await fs.copyFile(
        this.programPath(oldName),
        this.programPath(newName),
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(`Program ${newName} already exists.`);
      throw error;
    }
    await fs.unlink(this.programPath(oldName));
    await this.updateSettings({
      recent: this.settings.recent.map((name) => (name === oldName ? newName : name)),
      lastProgram: this.settings.lastProgram === oldName ? newName : this.settings.lastProgram,
    });
    return this.readProgram(newName);
  }

  async deleteProgram(value: unknown): Promise<void> {
    const name = normalizeProgramName(value);
    await this.regularFile(this.programPath(name));
    await fs.unlink(this.programPath(name));
    await this.updateSettings({ recent: this.settings.recent.filter((item) => item !== name) });
  }

  private async touchRecent(name: string): Promise<void> {
    await this.updateSettings({
      recent: [name, ...this.settings.recent.filter((item) => item !== name)],
      lastProgram: name,
    });
  }
  private programPath(name: string): string {
    return path.join(this.programsPath, normalizeProgramName(name) + '.abap');
  }
  private settingsPath(): string {
    return path.join(this.workspacePath, 'settings.json');
  }

  private async regularFile(filePath: string) {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Symbolic links and non-file programs are not supported.');
    return stat;
  }

  private async atomicWrite(filePath: string, text: string): Promise<void> {
    try {
      await this.regularFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = filePath + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, text, { flag: 'wx', encoding: 'utf8' });
      await fs.rename(temporary, filePath);
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  }
}
