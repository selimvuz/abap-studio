import { build } from 'electron-builder';
import { resolve } from 'node:path';
// Keep build caches alongside the checkout; no global installation is required.
process.env.ELECTRON_BUILDER_CACHE ??= resolve('.work/electron-builder-cache');
process.env.ELECTRON_CACHE ??= resolve('.work/electron-cache');
process.env.CSC_IDENTITY_AUTO_DISCOVERY ??= 'false';
await build({
  win: process.argv.includes('--dir') ? ['dir'] : ['nsis'],
  x64: true,
  publish: 'never',
  config: { electronDist: resolve('node_modules/electron/dist') },
});
