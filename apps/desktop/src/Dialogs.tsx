import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  X,
  FileCode2,
  ArrowRight,
  Command,
  ShieldCheck,
  Settings2,
  AlertTriangle,
} from 'lucide-react';
import type {
  DataValue,
  Parameter,
  Settings,
  Variable,
} from '../../../packages/shared/src/index.js';

export function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() =>
      (
        box.current?.querySelector<HTMLElement>('input,select,textarea') ??
        box.current?.querySelector<HTMLElement>('button,[tabindex]')
      )?.focus(),
    );
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const items = box.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', key, true);
      previous?.focus();
    };
  }, []);
  return (
    <div className="dialog-backdrop">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`dialog ${wide ? 'dialog-wide' : ''}`}
      >
        <div className="dialog-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function NameDialog({
  kind,
  initial,
  onSubmit,
  onClose,
}: {
  kind: 'new' | 'rename' | 'duplicate' | 'saveAs';
  initial: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const title = {
    new: 'New program',
    rename: 'Rename program',
    duplicate: 'Duplicate program',
    saveAs: 'Save program as',
  }[kind];
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onSubmit(name);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={title} subtitle="A local ABAP report, ready to make your own." onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field-label" htmlFor="program-name">
          Program name
        </label>
        <div className="name-input">
          <FileCode2 size={17} />
          <input
            autoFocus
            id="program-name"
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase())}
            spellCheck={false}
            placeholder="ZMY_PROGRAM"
            maxLength={45}
          />
          <span>.abap</span>
        </div>
        <p className="field-hint">Letters, numbers and underscores · up to 40 characters</p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy || !name.trim()}>
            {busy
              ? 'Saving…'
              : kind === 'new'
                ? 'Create program'
                : kind === 'rename'
                  ? 'Rename'
                  : 'Save program'}
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function ParametersDialog({
  program,
  parameters,
  onSubmit,
  onClose,
}: {
  program: string;
  parameters: Parameter[];
  onSubmit: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(parameters.map((p) => [p.name, p.defaultValue])),
  );
  return (
    <Dialog
      title={`Run ${program}`}
      subtitle="Provide the report parameters for this execution."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(values);
        }}
      >
        <div className="parameter-fields">
          {parameters.map((parameter) => (
            <label className="parameter-field" key={parameter.name}>
              <span>
                {parameter.name}
                <small>{parameter.type}</small>
              </span>
              <input
                value={values[parameter.name]}
                onChange={(e) => setValues({ ...values, [parameter.name]: e.target.value })}
                spellCheck={false}
              />
            </label>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Run program
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function SettingsDialog({
  settings,
  workspace,
  onSave,
  onClose,
}: {
  settings: Settings;
  workspace: string;
  onSave: (value: Partial<Settings>) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings),
    [error, setError] = useState('');
  return (
    <Dialog
      title="Preferences"
      subtitle="Make a little room for the way you work."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(draft)
            .then(onClose)
            .catch((e) => setError(e.message));
        }}
      >
        <h3 className="settings-heading">
          <Settings2 size={15} />
          Editor
        </h3>
        <div className="settings-grid">
          <label>
            Appearance
            <select
              value={draft.theme}
              onChange={(e) => setDraft({ ...draft, theme: e.target.value as Settings['theme'] })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label>
            Font size
            <input
              type="number"
              min={11}
              max={24}
              value={draft.fontSize}
              onChange={(e) => setDraft({ ...draft, fontSize: Number(e.target.value) })}
            />
          </label>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.minimap}
            onChange={(e) => setDraft({ ...draft, minimap: e.target.checked })}
          />
          Show editor minimap
        </label>
        <h3 className="settings-heading">
          <ShieldCheck size={15} />
          Runtime limits
        </h3>
        <div className="settings-grid">
          <label>
            Timeout (milliseconds)
            <input
              type="number"
              min={100}
              max={120000}
              step={100}
              value={draft.timeoutMs}
              onChange={(e) => setDraft({ ...draft, timeoutMs: Number(e.target.value) })}
            />
          </label>
          <label>
            Statement limit
            <input
              type="number"
              min={100}
              max={10000000}
              step={100}
              value={draft.maxStatements}
              onChange={(e) => setDraft({ ...draft, maxStatements: Number(e.target.value) })}
            />
          </label>
          <label>
            Worker memory (MB)
            <input
              type="number"
              min={64}
              max={512}
              step={16}
              value={draft.memoryLimitMb}
              onChange={(e) => setDraft({ ...draft, memoryLimitMb: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="field-hint">
          Limits apply to the next run. Stop always terminates the execution worker.
        </p>
        <div className="workspace-path">
          <span>LOCAL WORKSPACE</span>
          <code>{workspace}</code>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Save preferences
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function HelpDialog({
  about,
  version,
  onClose,
}: {
  about: boolean;
  version: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={about ? 'About ABAP Studio' : 'A familiar language. A lighter workspace.'}
      subtitle={
        about
          ? `Version ${version} · Local-first ABAP development`
          : 'A focused, offline environment for small ABAP reports.'
      }
      onClose={onClose}
      wide
    >
      <div className="help-body">
        {about ? (
          <>
            <div className="about-brand">
              <span className="brand-mark">
                a<span>_</span>
              </span>
              <div>
                <h3>ABAP Studio</h3>
                <p>Write. Check. Run.</p>
              </div>
            </div>
            <p>
              A standalone desktop editor and interpreter inspired by the fast report workflow of
              SE38. Your programs are regular .abap files stored on your computer.
            </p>
            <p>
              This is an independent project. It does not connect to SAP systems or implement the
              full SAP ABAP platform.
            </p>
          </>
        ) : (
          <>
            <div className="help-flow">
              <span>
                <b>01</b> Write ABAP
              </span>
              <ArrowRight size={15} />
              <span>
                <b>02</b> Check <kbd>Ctrl F2</kbd>
              </span>
              <ArrowRight size={15} />
              <span>
                <b>03</b> Run <kbd>F8</kbd>
              </span>
            </div>
            <h3>Start with a report</h3>
            <pre className="example-code">
              {'REPORT zhello_world.\n\nDATA(lv_name) = `World`.\nWRITE |Hello { lv_name }|.'}
            </pre>
            <h3>Small reports, real language foundations</h3>
            <p>
              The current interpreter focuses on declarations, expressions, strings, control flow,
              structures, standard internal tables, report events and simple parameters. Use Check
              to validate what the interpreter supports. Completion includes broader ABAP vocabulary
              and is not a compatibility guarantee.
            </p>
            <p className="help-note">
              <AlertTriangle size={16} />
              Advanced ABAP Objects, Open SQL, SAP connectivity and full SAP compatibility are
              outside this release. Step Into currently uses the same statement-level stepping as
              Step Over.
            </p>
            <h3>Make the editor yours</h3>
            <p>
              Click the gutter to toggle a breakpoint. Press F5 to start debugging, then F10 to
              advance a statement. Inspect structured variables by expanding them; double-click a
              table to open its rows.
            </p>
            <div className="shortcut-grid">
              {[
                ['Run program', 'F8'],
                ['Check program', 'Ctrl F2'],
                ['Save', 'Ctrl S'],
                ['Save as', 'Ctrl Shift S'],
                ['Format', 'Ctrl Shift F'],
                ['Start / continue debug', 'F5'],
                ['Step over / into', 'F10 / F11'],
                ['Stop', 'Shift F5'],
                ['Quick open', 'Ctrl P'],
                ['Command palette', 'Ctrl Shift P'],
              ].map(([label, key]) => (
                <div key={label}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="help-footer">
          <Command size={15} />
          <span>Everything runs locally. No account or connection required.</span>
        </div>
      </div>
      <div className="dialog-actions">
        <button className="button primary" onClick={onClose}>
          Back to editor
        </button>
      </div>
    </Dialog>
  );
}
export function TableDialog({ variable, onClose }: { variable: Variable; onClose: () => void }) {
  const rows = Array.isArray(variable.value) ? variable.value : [];
  const [page, setPage] = useState(0),
    pageSize = 100,
    pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const columns = Array.from(
    new Set(
      rows
        .slice(0, 100)
        .flatMap((row) =>
          row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : ['VALUE'],
        ),
    ),
  );
  const format = (value: DataValue | undefined) =>
    value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return (
    <Dialog
      title={variable.name}
      subtitle={`${rows.length} ${rows.length === 1 ? 'row' : 'rows'} · ${variable.type}`}
      onClose={onClose}
      wide
    >
      <div className="table-view">
        <table>
          <thead>
            <tr>
              <th>#</th>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(page * pageSize, (page + 1) * pageSize).map((row, index) => (
              <tr key={index}>
                <td>{page * pageSize + index + 1}</td>
                {columns.map((column) => (
                  <td key={column}>
                    {format(
                      row && typeof row === 'object' && !Array.isArray(row) ? row[column] : row,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty-copy">This internal table has no rows.</p>}
      </div>
      {pageCount > 1 && (
        <div className="table-pagination">
          <span>
            Page {page + 1} of {pageCount} · 100 rows per page
          </span>
          <div>
            <button className="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button
              className="button"
              disabled={page >= pageCount - 1}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
      <div className="dialog-actions">
        <button className="button primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
