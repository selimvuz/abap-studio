# Architecture

ABAP Studio is an Electron desktop application. The production build loads local files; it has no HTTP server, sign-in, cloud dependency, or remote editor assets.

## Boundaries

```
Native Electron menu + window
  ↕ named IPC methods through an isolated preload
React interface + Monaco editor
  ↕ serializable desktop contracts
Main process: program store + worker lifecycle
  ↕ worker messages
Language service → lexer → parser → explicit AST → semantic analysis
  ↓
AST interpreter → typed execution context → output + debug snapshots
```

The language packages never import Electron, React, or Monaco. They can be bundled for Node independently. The lexer retains source coordinates, the parser builds explicit nodes, and the runtime interprets those nodes. ABAP is never passed to JavaScript `eval`, `Function`, a shell, or a native-code compiler.

## Repository map

- `apps/desktop/electron`: window, native menu, validated IPC, preload, filesystem store, worker controller.
- `apps/desktop/src`: editor interface, Monaco language registration, themes, dialogs, panels.
- `packages/shared`: serializable interface contracts.
- `packages/abap-ast`: source locations and discriminated syntax nodes.
- `packages/abap-lexer`: tokens, literals, comments, templates.
- `packages/abap-parser`: grammar and expression precedence.
- `packages/abap-language-service`: syntax/semantic diagnostics and formatting.
- `packages/abap-runtime`: execution context, types, control flow, tables, expressions.
- `packages/abap-standard-library`: supported pure built-ins.
- `tests`: language, storage, and execution tests; `tests/abap` contains compatibility fixtures.
- `scripts`: development, build, packaging, icon generation, and Electron smoke verification.

## Process isolation and limits

The renderer has `contextIsolation: true`, `nodeIntegration: false`, and sandboxing enabled. A narrowly scoped `window.desktop` bridge exposes named application operations, not Node objects or unrestricted IPC. The main process validates requests. Source file paths cannot be selected by supplying a path through a program name. External file import/export uses native file dialogs.

Each run starts a fresh Node worker thread. A statement budget protects the interpreter, including empty loop iterations. A main-process timer can terminate a stuck worker independently of its cooperation. Worker V8 resource limits constrain heap and stack; they are not a complete OS-level resident-memory quota. Output and source sizes are also bounded. Stop terminates the worker; the next run creates a clean context.

Language checks and formatting also run in workers. They do not block Monaco's rendering thread. Production assets use a restrictive content security policy and bundled editor workers. The application neither fetches remote content nor provides an ABAP networking/filesystem API.

## Debugging

The interpreter offers an awaited callback before each executable statement. Debug mode sends a snapshot containing the source line, variables, and statement count, then waits for a command. Continue resumes until a breakpoint; stepping pauses at the next statement. Because procedure calls are not in this milestone, Step Into and Step Over currently have the same statement-level behavior.

The external execution timer is suspended during a user pause. A Stop command still terminates a paused worker immediately. Snapshots are plain serializable data, so the renderer does not share live runtime objects.

## Storage

The default workspace is `Documents/ABAP Playground`. Reports are UTF-8 `.abap` files in `programs/`; settings live separately in the workspace. Writes use temporary files before replacement. No database is required. The `ABAP_STUDIO_WORKSPACE` environment variable selects another workspace for testing or portable workflows.

## Extension points

Add syntax as lexer tokens and explicit AST nodes, parse it, validate it, then interpret it and add compatibility tests. Do not translate unsupported ABAP into JavaScript. Future SQL should use its own AST and semantics adapter before SQLite. Objects should introduce typed heap references and call frames before the debugger gains true call-depth stepping.
