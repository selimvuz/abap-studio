import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  FileCode2,
  ListTree,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type { DataValue, Diagnostic, Variable } from '../../../packages/shared/src/index.js';
export type PanelTab = 'Output' | 'Problems' | 'Variables' | 'Debug Console';
export type RuntimeStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'stopped';
const display = (value: DataValue): string =>
  Array.isArray(value)
    ? `${value.length} ${value.length === 1 ? 'row' : 'rows'}`
    : value !== null && typeof value === 'object'
      ? `${Object.keys(value).length} fields`
      : typeof value === 'string'
        ? `'${value}'`
        : String(value);
function ValueTree({
  name,
  value,
  type,
  depth = 0,
  onTable,
}: {
  name: string;
  value: DataValue;
  type?: string;
  depth?: number;
  onTable?: (variable: Variable) => void;
}) {
  const [expanded, setExpanded] = useState(false),
    composite = value !== null && typeof value === 'object';
  return (
    <>
      <div
        className="variable-row"
        style={{ paddingLeft: 14 + depth * 18 }}
        onDoubleClick={() =>
          Array.isArray(value)
            ? onTable?.({ name, type: type ?? 'table', value })
            : setExpanded(!expanded)
        }
      >
        <button
          className={`variable-expander ${composite ? '' : 'invisible'}`}
          tabIndex={composite ? 0 : -1}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="variable-name">{name}</span>
        <span className="variable-type">
          {type ?? (Array.isArray(value) ? 'table' : typeof value)}
        </span>
        <span className={`variable-value ${composite ? 'composite' : ''}`}>{display(value)}</span>
      </div>
      {expanded &&
        composite &&
        Object.entries(value)
          .slice(0, 100)
          .map(([key, item]) => (
            <ValueTree
              key={key}
              name={Array.isArray(value) ? `[${Number(key) + 1}]` : key}
              value={item}
              depth={depth + 1}
              onTable={onTable}
            />
          ))}
      {expanded && composite && Object.keys(value).length > 100 && (
        <div className="field-hint">
          Showing the first 100 values. Open the table viewer for all rows.
        </div>
      )}
    </>
  );
}
export function OutputPanel({
  tab,
  onTab,
  output,
  diagnostics,
  variables,
  status,
  runName,
  duration,
  statements,
  debugLog,
  onNavigate,
  onClear,
  onClose,
  onTable,
}: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  output: string;
  diagnostics: Diagnostic[];
  variables: Variable[];
  status: RuntimeStatus;
  runName: string;
  duration?: number;
  statements: number;
  debugLog: string[];
  onNavigate: (line: number, column?: number) => void;
  onClear: () => void;
  onClose: () => void;
  onTable: (variable: Variable) => void;
}) {
  const outputRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);
  return (
    <section className="output-panel" aria-label="Results panel">
      <div className="panel-bar">
        <div className="panel-tabs">
          {(['Output', 'Problems', 'Variables', 'Debug Console'] as PanelTab[]).map((item) => (
            <button
              key={item}
              className={`panel-tab ${tab === item ? 'active' : ''}`}
              onClick={() => onTab(item)}
              aria-selected={tab === item}
            >
              {item === 'Output' && <Terminal size={13} />}
              <span>{item}</span>
              {item === 'Problems' && diagnostics.length > 0 && (
                <span className="count-badge error-count">{diagnostics.length}</span>
              )}
              {item === 'Variables' && variables.length > 0 && (
                <span className="count-badge">{variables.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="panel-tools">
          <button
            className="icon-button"
            aria-label="Clear output"
            title="Clear output"
            onClick={onClear}
          >
            <Trash2 size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Hide results panel"
            title="Hide panel"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="panel-content">
        {tab === 'Output' && (
          <>
            <div className="output-meta">
              <span className={`run-state ${status}`}>
                {status === 'completed' ? <CircleCheck size={12} /> : <Circle size={10} />}{' '}
                {status === 'idle'
                  ? 'Ready'
                  : status === 'running'
                    ? 'Running'
                    : status === 'paused'
                      ? 'Paused'
                      : status === 'completed'
                        ? 'Finished'
                        : status === 'error'
                          ? 'Failed'
                          : 'Stopped'}
              </span>
              {runName && <span className="mono">{runName}</span>}
              {duration !== undefined && (
                <span>
                  {duration < 1000
                    ? `${duration.toFixed(0)} ms`
                    : `${(duration / 1000).toFixed(2)} s`}
                  <span className="meta-dot">·</span>
                  {statements} statements
                </span>
              )}
            </div>
            {output ? (
              <pre ref={outputRef} className="output-text" data-testid="output-text">
                {output}
              </pre>
            ) : (
              <div className="output-empty" data-testid="output">
                <span className="console-prompt">›</span>
                <div>
                  {status === 'running'
                    ? 'Waiting for program output…'
                    : status === 'completed'
                      ? 'Program finished without output.'
                      : 'Your program’s output appears here.'}
                  <span>
                    Run the current report with <kbd>F8</kbd>
                  </span>
                </div>
              </div>
            )}
          </>
        )}
        {tab === 'Problems' && (
          <div className="diagnostics" data-testid="problems">
            {diagnostics.length ? (
              diagnostics.map((item, index) => (
                <button
                  className={`diagnostic ${item.severity}`}
                  key={index}
                  onClick={() => onNavigate(item.line, item.column)}
                >
                  {item.severity === 'error' ? (
                    <AlertCircle size={15} />
                  ) : (
                    <AlertTriangle size={15} />
                  )}
                  <span>{item.message}</span>
                  <code>
                    Ln {item.line}, Col {item.column}
                  </code>
                </button>
              ))
            ) : (
              <div className="panel-empty">
                <CheckCheck size={22} />
                <div>
                  No problems to show
                  <span>
                    Check your report with <kbd>Ctrl F2</kbd>.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'Variables' && (
          <div className="variables" data-testid="variables">
            {variables.length ? (
              <>
                <div className="variable-header">
                  <span>NAME</span>
                  <span>TYPE</span>
                  <span>VALUE</span>
                </div>
                {variables.map((variable) => (
                  <ValueTree key={variable.name} {...variable} onTable={onTable} />
                ))}
              </>
            ) : (
              <div className="panel-empty">
                <ListTree size={22} />
                <div>
                  Variables are waiting<span>Run or pause a report to inspect its values.</span>
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'Debug Console' && (
          <div className="debug-console">
            {debugLog.length ? (
              debugLog.map((line, index) => (
                <div key={index}>
                  <span className="debug-prefix">›</span>
                  {line}
                </div>
              ))
            ) : (
              <div className="panel-empty">
                <FileCode2 size={22} />
                <div>
                  Step through your report
                  <span>
                    Set a gutter breakpoint or start debugging with <kbd>F5</kbd>.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
