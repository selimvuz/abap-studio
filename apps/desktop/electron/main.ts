import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProgramStore, MAX_SOURCE_BYTES, normalizeProgramName, validateSource } from './storage';
import { ExecutionController } from './execution';
import { installApplicationMenu } from './menu';
import type { ProgramFile } from '../../../packages/shared/src/index';

app.setName('ABAP Studio');
app.setAppUserModelId('dev.abap.studio');
const testMode = process.env.ABAP_STUDIO_TEST === '1';
if (testMode && process.env.ABAP_STUDIO_WORKSPACE)
  app.setPath('userData', path.join(process.env.ABAP_STUDIO_WORKSPACE, '.electron'));

let window: BrowserWindow | undefined;
let store: ProgramStore;
let execution: ExecutionController;
let dirty = false;
let closing = false;
let closeDialogOpen = false;
const rendererPath = path.join(__dirname, '../dist-renderer/index.html');
const rendererUrl = pathToFileURL(rendererPath).href;
const developmentUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;

function trustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    return false;
  const url = event.senderFrame?.url;
  if (!url) return false;
  if (developmentUrl) {
    try {
      return new URL(url).origin === new URL(developmentUrl).origin;
    } catch {
      return false;
    }
  }
  return url.split('#')[0] === rendererUrl;
}

function handle(channel: string, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(`studio:${channel}`, (event, ...args: unknown[]) => {
    if (!trustedSender(event)) throw new Error('Untrusted desktop request.');
    return handler(...args);
  });
}

function registerBridge(): void {
  handle('bootstrap', async () => ({
    programs: await store.listPrograms(),
    settings: store.getSettings(),
    workspacePath: store.workspacePath,
    version: app.getVersion(),
  }));
  handle('listPrograms', () => store.listPrograms());
  handle('saveProgram', (name, source) => store.saveProgram(name, source));
  handle('renameProgram', (oldName, newName) => store.renameProgram(oldName, newName));
  handle('deleteProgram', (name) => store.deleteProgram(name));
  handle('openProgram', () => importProgram());
  handle('exportProgram', (name, source) => exportProgram(name, source));
  handle('updateSettings', async (patch) => {
    const settings = await store.updateSettings(patch);
    nativeTheme.themeSource = settings.theme;
    return settings;
  });
  handle('check', (source) => execution.check(source));
  handle('format', (source) => execution.format(source));
  handle('run', (request) => execution.run(request, store.getSettings()));
  handle('stop', () => execution.stop());
  handle('debug', (command) => execution.debug(command));
  ipcMain.on('studio:setDirty', (event, value: unknown) => {
    if (trustedSender(event) && typeof value === 'boolean') dirty = value;
  });
}

async function importProgram(): Promise<ProgramFile | null> {
  const result = await dialog.showOpenDialog(window!, {
    title: 'Open ABAP Program',
    properties: ['openFile'],
    filters: [{ name: 'ABAP Source', extensions: ['abap'] }],
    defaultPath: store.programsPath,
  });
  const filePath = result.filePaths[0];
  if (result.canceled || !filePath) return null;
  const stat = await fs.lstat(filePath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > MAX_SOURCE_BYTES ||
    path.extname(filePath).toLowerCase() !== '.abap'
  )
    throw new Error('Choose a regular .abap source file smaller than 1 MB.');
  let name = normalizeProgramName(path.basename(filePath));
  const source = validateSource(await fs.readFile(filePath, 'utf8'));
  const programs = await store.listPrograms();
  const existing = programs.find((program) => program.name === name);
  if (existing) {
    if (existing.source === source) return existing;
    const conflict = await dialog.showMessageBox(window!, {
      type: 'question',
      title: 'Program Already Exists',
      message: `${name} already exists in your workspace.`,
      detail: 'Replace its saved source, or import this file under a new name.',
      buttons: ['Keep Both', 'Replace', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (conflict.response === 2) return null;
    if (conflict.response === 0) {
      const base = name.slice(0, 34);
      let counter = 2;
      while (programs.some((program) => program.name === `${base}_${counter}`)) ++counter;
      name = `${base}_${counter}`;
    }
    return store.saveProgram(name, source, conflict.response === 0);
  }
  return store.saveProgram(name, source, true);
}

async function exportProgram(nameValue: unknown, sourceValue: unknown): Promise<boolean> {
  const name = normalizeProgramName(nameValue);
  const source = validateSource(sourceValue);
  const result = await dialog.showSaveDialog(window!, {
    title: 'Export ABAP Source',
    defaultPath: path.join(app.getPath('documents'), name + '.abap'),
    filters: [{ name: 'ABAP Source', extensions: ['abap'] }],
  });
  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, source, 'utf8');
  return true;
}

async function createWindow(): Promise<void> {
  const workspace =
    process.env.ABAP_STUDIO_WORKSPACE ?? path.join(app.getPath('documents'), 'ABAP Playground');
  store = new ProgramStore(path.resolve(workspace));
  await store.initialize();
  nativeTheme.themeSource = store.getSettings().theme;
  window = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    title: 'ABAP Studio',
    backgroundColor: '#111318',
    show: false,
    autoHideMenuBar: false,
    icon: path.join(__dirname, '../build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  const workerPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'execution-worker.cjs')
    : path.join(__dirname, 'execution-worker.cjs');
  execution = new ExecutionController(workerPath, (event) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:runtime', event);
  });
  registerBridge();
  installApplicationMenu((action) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:menu', action);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const scripts = developmentUrl ? "'self' 'unsafe-inline'" : "'self'";
    const connections = developmentUrl ? "'self' ws://localhost:* ws://127.0.0.1:*" : "'none'";
    const csp = `default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src ${connections}; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'`;
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  window.once('ready-to-show', () => {
    if (process.env.ABAP_STUDIO_HIDDEN !== '1') window?.show();
  });
  window.on('close', (event) => {
    if (closing || !dirty || testMode) return;
    event.preventDefault();
    if (closeDialogOpen) return;
    closeDialogOpen = true;
    void dialog
      .showMessageBox(window!, {
        type: 'warning',
        title: 'Unsaved Changes',
        message: 'Discard unsaved changes and close ABAP Studio?',
        detail: 'Your open programs contain changes that have not been saved.',
        buttons: ['Keep Editing', 'Discard and Close'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then((result) => {
        closeDialogOpen = false;
        if (result.response === 1) {
          closing = true;
          window?.close();
        }
      });
  });
  window.on('closed', () => {
    window = undefined;
    void execution.dispose();
  });
  if (developmentUrl) await window.loadURL(developmentUrl);
  else await window.loadFile(rendererPath);
}

void app
  .whenReady()
  .then(createWindow)
  .catch((error) => {
    dialog.showErrorBox(
      'ABAP Studio Could Not Start',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
