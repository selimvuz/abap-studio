import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const result = spawnSync(process.execPath, ['node_modules/electron/install.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    electron_config_cache: process.env.electron_config_cache ?? resolve('.work/electron-cache'),
  },
});
process.exit(result.status ?? 1);
