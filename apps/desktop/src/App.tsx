import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  Braces,
  Bug,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  CircleHelp,
  Command,
  FileCode2,
  FilePlus2,
  FolderOpen,
  Maximize2,
  Moon,
  PanelBottom,
  PanelLeft,
  Play,
  Save,
  Search,
  Settings2,
  SkipForward,
  Square,
  StepForward,
  Sun,
  X,
} from 'lucide-react';
import type {
  Parameter,
  ProgramFile,
  RunRequest,
  Variable,
} from '../../../packages/shared/src/index.js';
import { CodeEditor, type EditorHandle } from './CodeEditor';
import { CommandPalette, type PaletteItem } from './CommandPalette';
import {
  Dialog,
  HelpDialog,
  NameDialog,
  ParametersDialog,
  SettingsDialog,
  TableDialog,
} from './Dialogs';
import { OutputPanel, type PanelTab } from './Panels';
import { Sidebar } from './Sidebar';
import { useWorkspace, type ConfirmChoice } from './useWorkspace';
import { useExecution } from './useExecution';

type Modal =
  | { kind: 'new' | 'rename' | 'duplicate' | 'saveAs'; name: string; source?: string }
  | { kind: 'delete'; name: string }
  | { kind: 'parameters'; parameters: Parameter[]; request: RunRequest }
  | { kind: 'settings' | 'help' | 'about' }
  | { kind: 'table'; variable: Variable };
const shortcuts: Record<string, string> = {
  new: 'Ctrl N',
  open: 'Ctrl O',
  save: 'Ctrl S',
  saveAs: 'Ctrl Shift S',
  check: 'Ctrl F2',
  run: 'F8',
  debug: 'F5',
  stepOver: 'F10',
  stepInto: 'F11',
  stop: 'Shift F5',
  format: 'Ctrl Shift F',
  quickOpen: 'Ctrl P',
  commandPalette: 'Ctrl Shift P',
};
function resize(
  event: React.MouseEvent,
  axis: 'x' | 'y',
  value: number,
  change: (value: number) => void,
  min: number,
  max: number,
) {
  event.preventDefault();
  const origin = axis === 'x' ? event.clientX : event.clientY;
  document.body.classList.add('resizing');
  const move = (e: MouseEvent) =>
    change(
      Math.max(
        min,
        Math.min(max, value + (axis === 'x' ? e.clientX - origin : origin - e.clientY)),
      ),
    );
  const stop = () => {
    document.body.classList.remove('resizing');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', stop);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', stop);
}

export function App() {
  const [toast, setToast] = useState<{ message: string; tone: 'error' | 'success' }>(),
    [confirmation, setConfirmation] = useState<{ title: string; message: string }>();
  const confirmationResolve = useRef<((choice: ConfirmChoice) => void) | undefined>(undefined);
  const notify = useCallback(
    (message: string, tone: 'error' | 'success' = 'success') => setToast({ message, tone }),
    [],
  );
  const confirm = useCallback(
    (title: string, message: string) =>
      new Promise<ConfirmChoice>((resolve) => {
        confirmationResolve.current = resolve;
        setConfirmation({ title, message });
      }),
    [],
  );
  const workspace = useWorkspace(confirm, notify),
    execution = useExecution(notify),
    editor = useRef<EditorHandle>(null);
  const [modal, setModal] = useState<Modal>(),
    [palette, setPalette] = useState<'commands' | 'programs'>(),
    [panel, setPanel] = useState<PanelTab>('Output');
  const [showSidebar, setShowSidebar] = useState(true),
    [showPanel, setShowPanel] = useState(true),
    [sidebarWidth, setSidebarWidth] = useState(238),
    [panelHeight, setPanelHeight] = useState(230);
  const [position, setPosition] = useState({ line: 1, column: 1 }),
    [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({});
  const active = workspace.active,
    busy = execution.status === 'running' || execution.status === 'paused';
  const diagnostics =
    execution.checkedName === active?.name && execution.checkedSource === active?.source
      ? execution.diagnostics
      : [];
  const checked =
    !!active && execution.checkedName === active.name && execution.checkedSource === active.source;
  const activeBreakpoints = breakpoints[active?.name ?? ''] ?? [];
  const safe = useCallback(
    (task: () => Promise<unknown>) => {
      void task().catch((e) => notify(e instanceof Error ? e.message : String(e), 'error'));
    },
    [notify],
  );
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(undefined), toast.tone === 'error' ? 8000 : 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = workspace.settings.theme;
  }, [workspace.settings.theme]);
  const showResults = (tab: PanelTab) => {
    setPanel(tab);
    setShowPanel(true);
  };
  const run = async (debug = false) => {
    if (!active || busy || execution.checking) return;
    setToast(undefined);
    const name = active.name,
      source = active.source,
      result = await execution.check(name, source);
    if (result.diagnostics.some((item) => item.severity === 'error')) {
      showResults('Problems');
      notify('Resolve the syntax errors before running this report.', 'error');
      return;
    }
    const request: RunRequest = { name, source, debug, breakpoints: breakpoints[name] ?? [] };
    if (result.parameters.length) {
      setModal({ kind: 'parameters', parameters: result.parameters, request });
      return;
    }
    showResults('Output');
    await execution.start(request);
  };
  const doCheck = async () => {
    if (!active) return;
    const result = await execution.check(active.name, active.source);
    if (result.diagnostics.length) showResults('Problems');
    else notify('Syntax check passed. Ready to run.');
  };
  const togglePanel = (tab: PanelTab) => {
    if (showPanel && panel === tab) setShowPanel(false);
    else showResults(tab);
  };
  const command = async (action: string) => {
    if (action === 'new') setModal({ kind: 'new', name: '' });
    else if (action === 'open') await workspace.importProgram();
    else if (action === 'save') await workspace.save();
    else if (action === 'saveAs' && active)
      setModal({ kind: 'saveAs', name: `${active.name}_COPY`, source: active.source });
    else if (action === 'export' && active) {
      if (await window.desktop.exportProgram(active.name, active.source))
        notify('Program exported.');
    } else if (action === 'close') await workspace.close();
    else if (['undo', 'redo', 'cut', 'copy', 'paste', 'find', 'replace'].includes(action))
      editor.current?.action(
        (
          {
            cut: 'editor.action.clipboardCutAction',
            copy: 'editor.action.clipboardCopyAction',
            paste: 'editor.action.clipboardPasteAction',
            find: 'actions.find',
            replace: 'editor.action.startFindReplaceAction',
          } as Record<string, string>
        )[action] ?? action,
      );
    else if (action === 'format' && active && !busy) {
      workspace.update(await window.desktop.format(active.source));
      notify('Document formatted.');
    } else if (action === 'check') await doCheck();
    else if (action === 'run') await run();
    else if (action === 'stop' && busy) await execution.stop();
    else if (action === 'debug') {
      if (execution.status === 'paused') await execution.debug('continue');
      else await run(true);
    } else if (action === 'continue' || action === 'stepOver' || action === 'stepInto')
      await execution.debug(action);
    else if (action === 'togglePrograms') setShowSidebar((value) => !value);
    else if (action === 'toggleOutput') togglePanel('Output');
    else if (action === 'toggleProblems') togglePanel('Problems');
    else if (action === 'toggleVariables') togglePanel('Variables');
    else if (action === 'commandPalette') setPalette('commands');
    else if (action === 'quickOpen') setPalette('programs');
    else if (action === 'theme')
      await workspace.persistSettings({
        theme: workspace.settings.theme === 'dark' ? 'light' : 'dark',
      });
    else if (action === 'settings') setModal({ kind: 'settings' });
    else if (action === 'documentation') setModal({ kind: 'help' });
    else if (action === 'about') setModal({ kind: 'about' });
  };
  const commandRef = useRef(command);
  commandRef.current = command;
  const modalOpen = !!modal || !!confirmation || !!palette,
    modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;
  useEffect(() => {
    const invoke = (action: string) => {
      if (!modalOpenRef.current) safe(() => commandRef.current(action));
    };
    const unsubscribe = window.desktop.onMenu(invoke);
    const custom = (e: Event) => invoke((e as CustomEvent<string>).detail);
    const key = (e: KeyboardEvent) => {
      if (modalOpenRef.current || e.defaultPrevented) return;
      let action = '';
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F8') action = 'run';
      else if (e.key === 'F2' && mod) action = 'check';
      else if (e.key === 'F5') action = e.shiftKey ? 'stop' : 'debug';
      else if (e.key === 'F10') action = 'stepOver';
      else if (e.key === 'F11') action = 'stepInto';
      else if (mod && e.key.toLowerCase() === 's') action = e.shiftKey ? 'saveAs' : 'save';
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') action = 'format';
      else if (mod && e.key.toLowerCase() === 'p')
        action = e.shiftKey ? 'commandPalette' : 'quickOpen';
      if (action) {
        e.preventDefault();
        invoke(action);
      }
    };
    window.addEventListener('studio-command', custom);
    window.addEventListener('keydown', key);
    return () => {
      unsubscribe();
      window.removeEventListener('studio-command', custom);
      window.removeEventListener('keydown', key);
    };
  }, [safe]);
  const act = (action: string) => safe(() => command(action));
  const context = (action: 'rename' | 'duplicate' | 'delete' | 'export', program: ProgramFile) => {
    if (
      busy &&
      execution.runName === program.name &&
      (action === 'rename' || action === 'delete')
    ) {
      notify('Stop the running program before renaming or deleting it.', 'error');
      return;
    }
    if (action === 'export') {
      safe(async () => {
        if (
          await window.desktop.exportProgram(
            program.name,
            workspace.documents.find((doc) => doc.name === program.name)?.source ?? program.source,
          )
        )
          notify('Program exported.');
      });
      return;
    }
    if (action === 'delete') {
      setModal({ kind: 'delete', name: program.name });
      return;
    }
    setModal({
      kind: action,
      name: program.name,
      source:
        workspace.documents.find((doc) => doc.name === program.name)?.source ?? program.source,
    });
  };
  const commandItems: PaletteItem[] = [
    ['new', 'New program'],
    ['open', 'Open .abap file…'],
    ['save', 'Save program'],
    ['saveAs', 'Save program as…'],
    ['export', 'Export .abap file…'],
    ['close', 'Close program'],
    ['check', 'Check program'],
    ['run', 'Run program'],
    ['debug', 'Start / continue debugging'],
    ['stepOver', 'Step over'],
    ['stepInto', 'Step into'],
    ['stop', 'Stop program'],
    ['format', 'Format document'],
    ['quickOpen', 'Quick open program'],
    ['togglePrograms', 'Toggle Programs panel'],
    ['toggleOutput', 'Toggle Output panel'],
    ['toggleProblems', 'Toggle Problems panel'],
    ['toggleVariables', 'Toggle Variables panel'],
    ['theme', 'Switch color theme'],
    ['settings', 'Preferences'],
    ['documentation', 'Documentation'],
    ['about', 'About ABAP Studio'],
  ].map(([id, label]) => ({ id, label, shortcut: shortcuts[id], run: () => act(id) }));
  const recentNames = workspace.settings.recent;
  const programItems: PaletteItem[] = [...workspace.programs]
    .sort((a, b) => {
      const ai = recentNames.indexOf(a.name),
        bi = recentNames.indexOf(b.name);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    })
    .map((program) => ({
      id: program.name,
      label: program.name,
      detail: recentNames.includes(program.name) ? 'Recently opened' : '.abap',
      run: () => workspace.open(program),
    }));
  const resolveConfirm = (choice: ConfirmChoice) => {
    setConfirmation(undefined);
    confirmationResolve.current?.(choice);
    confirmationResolve.current = undefined;
  };

  if (workspace.error)
    return (
      <div className="launch-error">
        <AlertCircle size={30} />
        <h2>Workspace unavailable</h2>
        <p>{workspace.error}</p>
        <button className="button primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  if (!workspace.ready)
    return (
      <div className="launch-loading">
        <span className="brand-mark">
          a<span>_</span>
        </span>
        <span>Opening your workspace…</span>
      </div>
    );
  return (
    <div
      className="studio"
      style={
        {
          '--sidebar-width': `${showSidebar ? sidebarWidth : 0}px`,
          '--panel-height': `${showPanel ? panelHeight : 0}px`,
        } as CSSProperties
      }
    >
      <header className="app-bar">
        <div className="app-brand">
          <span className="brand-mark small">
            a<span>_</span>
          </span>
          <span>
            ABAP<span className="brand-word"> STUDIO</span>
          </span>
          <span className="app-bar-divider" />
          <span className="workspace-crumb">Local workspace</span>
        </div>
        <button className="top-search" onClick={() => setPalette('commands')}>
          <Search size={13} />
          <span>Search programs and commands</span>
          <kbd>Ctrl ⇧ P</kbd>
        </button>
        <div className="app-actions">
          <span className="offline-label">
            <i />
            Offline ready
          </span>
          <button
            className="icon-button"
            aria-label="Toggle programs panel"
            title="Toggle programs panel"
            onClick={() => setShowSidebar((v) => !v)}
          >
            <PanelLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Toggle theme"
            title={`Switch to ${workspace.settings.theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={() => act('theme')}
          >
            {workspace.settings.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            className="icon-button"
            aria-label="Preferences"
            title="Preferences"
            onClick={() => setModal({ kind: 'settings' })}
          >
            <Settings2 size={16} />
          </button>
        </div>
      </header>
      <div className="workbench">
        {showSidebar && (
          <>
            <Sidebar
              programs={workspace.programs}
              documents={workspace.documents}
              active={workspace.activeName}
              version={workspace.version}
              onOpen={workspace.open}
              onNew={() => act('new')}
              onImport={() => act('open')}
              onContext={context}
            />
            <div
              className="sidebar-resizer"
              role="separator"
              aria-label="Resize programs panel"
              aria-orientation="vertical"
              onMouseDown={(event) => resize(event, 'x', sidebarWidth, setSidebarWidth, 180, 400)}
            />
          </>
        )}
        <main className="main-workspace">
          <div className="editor-tabs">
            <div className="document-tabs">
              {workspace.documents.map((doc) => (
                <div
                  className={`document-tab ${doc.name === workspace.activeName ? 'active' : ''}`}
                  key={doc.name}
                >
                  <button
                    className="tab-label"
                    onClick={() => {
                      const program = workspace.programs.find((p) => p.name === doc.name);
                      if (program) workspace.open(program);
                    }}
                  >
                    <FileCode2 size={14} />
                    <span>
                      {doc.name}
                      <span className="file-extension">.abap</span>
                    </span>
                  </button>
                  <button
                    className={`tab-close ${doc.source !== doc.savedSource ? 'dirty' : ''}`}
                    aria-label={`Close ${doc.name}`}
                    onClick={() => safe(() => workspace.close(doc.name))}
                  >
                    {doc.source !== doc.savedSource ? (
                      <span className="dirty-dot" />
                    ) : (
                      <X size={13} />
                    )}
                  </button>
                </div>
              ))}
            </div>
            <button
              className="icon-button"
              aria-label="Quick open program"
              title="Quick open (Ctrl P)"
              onClick={() => setPalette('programs')}
            >
              <Search size={15} />
            </button>
          </div>
          {active ? (
            <>
              <div className="editor-toolbar">
                <div className="editor-breadcrumb">
                  <Braces size={14} />
                  <span>{active.name.toLowerCase()}.abap</span>
                  <ChevronRight size={12} />
                  <span className="report-label">Report</span>
                </div>
                <div className="editor-actions">
                  <button
                    className="icon-button save-button"
                    aria-label="Save program"
                    title="Save (Ctrl S)"
                    disabled={active.source === active.savedSource}
                    onClick={() => act('save')}
                  >
                    <Save size={15} />
                  </button>
                  <button
                    className="button check-button"
                    data-testid="check-button"
                    onClick={() => act('check')}
                    disabled={execution.checking}
                    title="Check program (Ctrl F2)"
                  >
                    {execution.checking ? <span className="spinner" /> : <CheckCheck size={15} />}
                    Check
                  </button>
                  <span className="toolbar-divider" />
                  {busy ? (
                    <button
                      className="button stop-button"
                      title="Stop program (Shift F5)"
                      aria-label="Stop program"
                      onClick={() => act('stop')}
                    >
                      <Square size={12} fill="currentColor" />
                      Stop
                    </button>
                  ) : (
                    <button
                      className="button run-button"
                      data-testid="run-button"
                      title="Run program (F8)"
                      onClick={() => act('run')}
                      disabled={execution.checking}
                    >
                      <Play size={13} fill="currentColor" />
                      Run<kbd>F8</kbd>
                    </button>
                  )}
                  <button
                    className={`icon-button debug-button ${execution.status === 'paused' ? 'paused' : ''}`}
                    aria-label={
                      execution.status === 'paused' ? 'Continue debugging' : 'Start debugging'
                    }
                    title={execution.status === 'paused' ? 'Continue (F5)' : 'Debug (F5)'}
                    disabled={execution.status === 'running'}
                    onClick={() => act('debug')}
                  >
                    <Bug size={16} />
                  </button>
                </div>
              </div>
              <div className="editor-region">
                <CodeEditor
                  ref={editor}
                  name={active.name}
                  source={active.source}
                  theme={workspace.settings.theme}
                  fontSize={workspace.settings.fontSize}
                  minimap={workspace.settings.minimap}
                  diagnostics={diagnostics}
                  breakpoints={activeBreakpoints}
                  currentLine={
                    execution.runName === active.name ? execution.snapshot?.line : undefined
                  }
                  readOnly={busy && execution.runName === active.name}
                  onChange={workspace.update}
                  onBreakpointLines={(lines) =>
                    setBreakpoints((values) => ({ ...values, [active.name]: lines }))
                  }
                  onPosition={(line, column) => setPosition({ line, column })}
                  onBreakpoint={(line) =>
                    setBreakpoints((values) => ({
                      ...values,
                      [active.name]: activeBreakpoints.includes(line)
                        ? activeBreakpoints.filter((item) => item !== line)
                        : [...activeBreakpoints, line].sort((a, b) => a - b),
                    }))
                  }
                />
                {execution.status === 'paused' && (
                  <div className="debug-controls">
                    <span>
                      <i />
                      Paused on line {execution.snapshot?.line}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="Continue"
                      title="Continue (F5)"
                      onClick={() => act('continue')}
                    >
                      <Play size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Step over"
                      title="Step over (F10)"
                      onClick={() => act('stepOver')}
                    >
                      <StepForward size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Step into"
                      title="Step into (F11)"
                      onClick={() => act('stepInto')}
                    >
                      <ArrowDownToLine size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Stop debugging"
                      title="Stop (Shift F5)"
                      onClick={() => act('stop')}
                    >
                      <Square size={12} />
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-editor">
              <span className="empty-symbol">
                <Braces size={36} />
              </span>
              <h2>A little code. A new possibility.</h2>
              <p>Open a report or start with a blank program.</p>
              <button onClick={() => act('new')}>
                <FilePlus2 size={16} />
                <span>New program</span>
                <kbd>Ctrl N</kbd>
              </button>
              <button onClick={() => setPalette('programs')}>
                <FolderOpen size={16} />
                <span>Open a program</span>
                <kbd>Ctrl P</kbd>
              </button>
              <button onClick={() => setModal({ kind: 'help' })}>
                <CircleHelp size={16} />
                <span>Explore the basics</span>
                <ArrowRight size={15} />
              </button>
            </div>
          )}
          {showPanel && (
            <>
              <div
                className="panel-resizer"
                role="separator"
                aria-label="Resize results panel"
                aria-orientation="horizontal"
                onMouseDown={(event) =>
                  resize(
                    event,
                    'y',
                    panelHeight,
                    setPanelHeight,
                    130,
                    Math.max(200, window.innerHeight - 260),
                  )
                }
              />
              <div className="panel-container">
                <OutputPanel
                  tab={panel}
                  onTab={setPanel}
                  output={execution.output}
                  diagnostics={diagnostics}
                  variables={execution.variables}
                  status={execution.status}
                  runName={execution.runName}
                  duration={execution.duration}
                  statements={execution.statements}
                  debugLog={execution.debugLog}
                  onNavigate={(line, column) => editor.current?.goTo(line, column)}
                  onClear={execution.clear}
                  onClose={() => setShowPanel(false)}
                  onTable={(variable) => setModal({ kind: 'table', variable })}
                />
              </div>
            </>
          )}
        </main>
      </div>
      <footer className="status-bar">
        <div>
          <span className={`status-runtime ${busy ? 'busy' : ''}`}>
            <i />
            {execution.status === 'paused'
              ? 'Debugger paused'
              : execution.status === 'running'
                ? 'Executing report'
                : 'Local runtime'}
          </span>
          <button
            onClick={() => showResults('Problems')}
            className={`status-diagnostics ${diagnostics.length ? 'has-errors' : ''}`}
          >
            {diagnostics.length ? (
              <>
                <AlertCircle size={12} />
                {diagnostics.filter((d) => d.severity === 'error').length}
                <span className="status-warning">
                  △ {diagnostics.filter((d) => d.severity === 'warning').length}
                </span>
              </>
            ) : checked ? (
              <>
                <Check size={12} />
                No issues
              </>
            ) : (
              <>
                <Circle size={10} />
                Not checked
              </>
            )}
          </button>
        </div>
        <div>
          {active && (
            <>
              <span>
                Ln {position.line}, Col {position.column}
              </span>
              <span>Spaces: 2</span>
              <span>UTF-8</span>
              <span className="language-status">ABAP</span>
            </>
          )}
          <button
            title="Toggle results panel"
            aria-label="Toggle results panel"
            onClick={() => setShowPanel((v) => !v)}
          >
            <PanelBottom size={13} />
          </button>
        </div>
      </footer>
      {toast && (
        <div className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          {toast.tone === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
          <span>{toast.message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast(undefined)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {palette && (
        <CommandPalette
          mode={palette}
          items={palette === 'commands' ? [...commandItems, ...programItems] : programItems}
          onClose={() => setPalette(undefined)}
        />
      )}
      {modal && ['new', 'rename', 'duplicate', 'saveAs'].includes(modal.kind) && (
        <NameDialog
          kind={modal.kind as 'new' | 'rename' | 'duplicate' | 'saveAs'}
          initial={
            'name' in modal ? (modal.kind === 'duplicate' ? `${modal.name}_COPY` : modal.name) : ''
          }
          onClose={() => setModal(undefined)}
          onSubmit={async (name) => {
            if (!('name' in modal)) return;
            if (modal.kind === 'rename') await workspace.rename(modal.name, name);
            else await workspace.create(name, 'source' in modal ? modal.source : undefined);
          }}
        />
      )}
      {modal?.kind === 'delete' && (
        <Dialog
          title="Delete program?"
          subtitle={`${modal.name}.abap will be removed from your local workspace.`}
          onClose={() => setModal(undefined)}
        >
          <p className="dialog-copy">
            This also discards any unsaved changes to this program. This action cannot be undone.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setModal(undefined)}>
              Cancel
            </button>
            <button
              className="button danger-solid"
              onClick={() =>
                safe(async () => {
                  await workspace.remove(modal.name);
                  setModal(undefined);
                  notify('Program deleted.');
                })
              }
            >
              Delete program
            </button>
          </div>
        </Dialog>
      )}
      {modal?.kind === 'parameters' && (
        <ParametersDialog
          program={modal.request.name}
          parameters={modal.parameters}
          onClose={() => setModal(undefined)}
          onSubmit={(values) => {
            setModal(undefined);
            showResults('Output');
            safe(() => execution.start({ ...modal.request, parameters: values }));
          }}
        />
      )}
      {modal?.kind === 'settings' && (
        <SettingsDialog
          settings={workspace.settings}
          workspace={workspace.workspacePath}
          onSave={workspace.persistSettings}
          onClose={() => setModal(undefined)}
        />
      )}
      {(modal?.kind === 'help' || modal?.kind === 'about') && (
        <HelpDialog
          about={modal.kind === 'about'}
          version={workspace.version}
          onClose={() => setModal(undefined)}
        />
      )}
      {modal?.kind === 'table' && (
        <TableDialog variable={modal.variable} onClose={() => setModal(undefined)} />
      )}
      {confirmation && (
        <Dialog
          title={confirmation.title}
          subtitle={confirmation.message}
          onClose={() => resolveConfirm('cancel')}
        >
          <p className="dialog-copy">Your edits will be lost if you continue without saving.</p>
          <div className="dialog-actions">
            <button className="button" onClick={() => resolveConfirm('cancel')}>
              Cancel
            </button>
            <button className="button" onClick={() => resolveConfirm('discard')}>
              Discard changes
            </button>
            <button className="button primary" onClick={() => resolveConfirm('save')}>
              Save changes
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
