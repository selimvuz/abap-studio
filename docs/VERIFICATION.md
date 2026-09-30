# Release verification — 0.1.0

Verified on Windows 11 x64, 29 September 2026, with Node.js 24.19.0 and Electron 44.4.5.

## Automated results

| Check                                                      | Result                              |
| ---------------------------------------------------------- | ----------------------------------- |
| Strict TypeScript                                          | Passed                              |
| Vitest language, compatibility, storage, and worker suites | **120 passed, 1 skipped, 0 failed** |
| Packaged Electron core workflow                            | **11 checks passed**                |
| Packaged Electron program-management interface             | **9 checks passed**                 |
| Production renderer and worker build                       | Passed                              |
| Windows x64 NSIS setup generation                          | Passed                              |

The skipped test attempts to create a Windows symbolic link; the execution account lacks that privilege. Ordinary path validation, reserved names, source limits, file collision handling, and storage persistence passed.

The two unchanged milestone programs are compatibility fixtures:

- `tests/abap/modern-syntax/hello.abap` produces `Hello World`.
- `tests/abap/internal-tables/people.abap` produces `Alice 30` and `Bob 25` on separate lines.

The Electron checks used the real packaged `ABAP Studio.exe`, local renderer files, preload bridge, and unpacked execution worker. They did not use a browser-only app or a mock runtime. They verified typing in Monaco and pressing F8, saving plain source files, diagnostics and editor markers, stepping and variable snapshots, stopping and restarting, runaway-loop limits, theme rendering, creation/duplication/rename/deletion, unsaved changes, quick open, command palette, and report parameter input. Both desktop suites reported no uncaught renderer exceptions.

Raw desktop results are in [SMOKE-RESULTS.json](SMOKE-RESULTS.json) and [UI-SMOKE-RESULTS.json](UI-SMOKE-RESULTS.json). Unit results are summarized in [UNIT-TEST-RESULTS.json](UNIT-TEST-RESULTS.json). Screenshots are in `docs/screenshots/`.

## Scope and environment limits

The restricted Windows execution host cannot create a nested Chromium renderer token. A normal test launch failed before renderer code loaded with Chromium sandbox error 49. The successful UI runs therefore explicitly set `ABAP_STUDIO_TEST_NO_CHROMIUM_SANDBOX=1`, which adds `--no-sandbox --in-process-gpu` only to the test launcher. This is recorded in the JSON results. Chromium sandbox startup on an ordinary installed Windows session remains unverified here.

The production window retains `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. The installed executable does not read the test launcher's sandbox override. Window configuration was inspected, and renderer access to Node's `require` was absent during execution.

The NSIS installer was generated and its Windows executable metadata checked. The application payload was launched and tested from `release/win-unpacked`; an interactive install/uninstall cycle against the user's actual profile was not performed. The installer is **unsigned** and can show a Windows unknown-publisher/SmartScreen prompt.

This release implements the documented procedural ABAP subset and the first two requested milestones. It does not claim complete SAP compatibility. Numeric precision, unsupported objects/SQL, and other language boundaries are described in [SUPPORTED-SYNTAX.md](SUPPORTED-SYNTAX.md).
