# Development and Windows builds

## Requirements

- Windows 10/11 x64 for the tested Windows target.
- Node.js 24 LTS recommended (minimum 22.12) and npm.
- Internet access for the initial dependency install and installer-tool download.

The installed application requires none of these development dependencies and runs offline.

## Commands

```powershell
npm ci
npm run dev
npm run test
npm run build
npm run test:e2e
npm run test:ui
npm run dist
```

`npm ci` runs `scripts/setup.mjs` to download the pinned Electron runtime. Dependencies are pinned in `package-lock.json`. `npm run dev` launches an actual Electron window with Vite renderer hot reload on loopback. Restart the command after changing main/preload/worker code. The development server is not used in the packaged application.

`npm run build` checks strict TypeScript, bundles the main process, sandbox-compatible preload, and execution worker with Rolldown, then creates the local renderer assets with Vite. `npm run test:e2e` launches the built Electron application in an isolated workspace and verifies desktop workflows.

`npm run dist` runs the build and electron-builder's NSIS x64 packaging. Outputs are in `release/`: `ABAP-Studio-Setup-0.1.0-x64.exe` and an unpacked application. `npm run dist:dir` builds only the unpacked directory.

## Installer

The assisted installer supports choosing the destination, a Start Menu entry, a desktop shortcut option, and normal uninstall support. The application icon and version metadata are embedded in the executable. Electron and Node are bundled inside the application; the user's system Node installation is irrelevant at runtime.

The generated development release is **unsigned**. Windows may display SmartScreen or an unknown-publisher prompt. A production publisher should supply its own signing certificate through electron-builder's documented signing configuration. No certificate or signing identity is embedded in this repository.

Uninstall intentionally preserves the user's workspace and ABAP source. Source reports must never be treated as disposable installation assets.

## Isolated execution

```powershell
$env:ABAP_STUDIO_WORKSPACE = 'C:\path\to\test-workspace'
npm run dev
```

The smoke script uses the testing environment to isolate user data. Tests never need to modify the real Documents workspace.

### Restricted Windows CI environments

Some already-restricted Windows process hosts cannot create Chromium's additional renderer token (Electron `launch-failed`, exit code 49). For UI testing **only**, opt in to:

```powershell
$env:ABAP_STUDIO_TEST_NO_CHROMIUM_SANDBOX = '1'
npm run test:e2e
```

The test launcher then uses `--no-sandbox --in-process-gpu`; this allows testing the actual Electron UI under the host's existing restrictions. It does **not** verify Chromium sandbox startup. Normal `npm run dev`, the installed executable, and the production window configuration do not use these flags. Leave the variable unset for normal desktop verification. The smoke results explicitly record when this workaround is used.

## Adding language support

1. Define a located AST node in `packages/abap-ast`.
2. Add lexer/parser behavior and invalid-syntax tests.
3. Implement symbol/type validation with useful source diagnostics.
4. Interpret the node using typed runtime values and explicit operations.
5. Add positive, invalid, boundary, and regression snippets in `tests/abap`.
6. Update `SUPPORTED-SYNTAX.md` and in-app documentation.
7. Run unit tests, strict type checks, and the desktop smoke tests.

Keep the two milestone programs unchanged as compatibility regressions. Do not relax diagnostics just to make an example pass.

## Reference documentation

- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [electron-builder NSIS configuration](https://www.electron.build/v26/docs/nsis/)

Third-party libraries remain under their respective licenses. The distributed Electron runtime includes its Chromium/third-party notices.
