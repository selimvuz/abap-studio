# ABAP Studio

A focused, offline Windows desktop IDE for ABAP reports. Built with Electron, React, TypeScript, Monaco, and an independent AST interpreter. It opens directly into the editor.

## Install and run

Run **ABAP-Studio-Setup-0.1.0-x64.exe** from the release folder. Choose the installation directory and shortcut options. Launch **ABAP Studio** from Start or the desktop.

The bundled `ZHELLO_WORLD` report is ready to run. Click **Check** or press **Ctrl+F2**, then press **F8**:

```abap
REPORT zhello_world.

DATA(lv_name) = `World`.

WRITE |Hello { lv_name }|.
```

The Output panel displays `Hello World`. Open `ZINTERNAL_TABLE` in the Programs panel for the second milestone, which prints `Alice 30` and `Bob 25` from a typed internal table.

No Node.js, account, browser tab, web server, or internet connection is required by the installed application. The installer is an unsigned development release; see [build notes](docs/DEVELOPMENT.md).

## Editor workflow

- Create, open/import, explicitly save, save a copy, rename, duplicate, delete, and reopen recent reports.
- Programs are plain `.abap` files under `Documents/ABAP Playground/programs`.
- Check produces source-located Problems and editor markers; click a problem to jump to it.
- Run reports with a parameter dialog when `PARAMETERS` declarations are present.
- Use the resizable Output, Problems, Variables, and Debug Console panels.
- Click the editor gutter to set breakpoints. Debug with F5, step with F10/F11, and inspect values or tables.
- Stop terminates the interpreter worker. Statement, time, output, and worker-memory limits protect the application.
- Switch light/dark themes, font size, minimap, and execution limits in Settings.

| Action           | Shortcut              |
| ---------------- | --------------------- |
| Run              | F8                    |
| Check            | Ctrl+F2               |
| Save / Save As   | Ctrl+S / Ctrl+Shift+S |
| Format           | Ctrl+Shift+F          |
| Start debugging  | F5                    |
| Continue         | Ctrl+F5               |
| Step over / into | F10 / F11             |
| Stop debugging   | Shift+F5              |
| Quick open       | Ctrl+P                |
| Command palette  | Ctrl+Shift+P          |

## Develop

Install Node.js 24 LTS, then run:

```powershell
npm ci
npm run dev
npm test
npm run build
npm run test:e2e
npm run test:ui
npm run dist
```

Build assets and the Windows setup are generated locally. See [developer instructions](docs/DEVELOPMENT.md) for requirements, isolated workspaces, packaging, and signing.

## Documentation

- [Architecture and security boundaries](docs/ARCHITECTURE.md)
- [Supported syntax and limitations](docs/SUPPORTED-SYNTAX.md)
- [Compatibility roadmap](docs/ROADMAP.md)
- [Verification results](docs/VERIFICATION.md)
- [Third-party notices](docs/THIRD-PARTY-NOTICES.txt)

This is a deliberately bounded ABAP-compatible subset, not a replacement for an SAP application server. Unsupported features produce diagnostics. It has no SAP backend connectivity, Open SQL, or ABAP Objects in this release. SAP and ABAP are trademarks of SAP SE; this independent project is not affiliated with or endorsed by SAP.

Source code is MIT licensed; bundled dependencies retain their own licenses.
