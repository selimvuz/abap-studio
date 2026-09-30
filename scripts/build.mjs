import { bundleShell } from './bundle-shell.mjs';
import { build as vite } from 'vite';
import { mkdir } from 'node:fs/promises';
import './third-party-notices.mjs';
await mkdir('dist-electron', { recursive: true });
await bundleShell();
await vite();
console.log('Desktop shell, interpreter worker and offline editor built.');
