import { useEffect, useRef, useState } from 'react';
import type {
  Diagnostic,
  ExecutionSnapshot,
  RunRequest,
  Variable,
} from '../../../packages/shared/src/index.js';
import type { RuntimeStatus } from './Panels';
export function useExecution(notify: (message: string, tone?: 'error' | 'success') => void) {
  const [status, setStatus] = useState<RuntimeStatus>('idle'),
    [output, setOutput] = useState(''),
    [variables, setVariables] = useState<Variable[]>([]),
    [snapshot, setSnapshot] = useState<ExecutionSnapshot>();
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]),
    [checkedSource, setCheckedSource] = useState(''),
    [checkedName, setCheckedName] = useState(''),
    [checking, setChecking] = useState(false);
  const [runName, setRunName] = useState(''),
    [duration, setDuration] = useState<number>(),
    [statements, setStatements] = useState(0),
    [debugLog, setDebugLog] = useState<string[]>([]);
  const request = useRef<RunRequest | null>(null),
    notifyRef = useRef(notify);
  notifyRef.current = notify;
  const log = (text: string) => setDebugLog((items) => [...items.slice(-199), text]);
  useEffect(
    () =>
      window.desktop.onRuntime((event) => {
        if (event.type === 'output') setOutput((text) => (text + event.text).slice(-2000000));
        if (event.type === 'paused') {
          setStatus('paused');
          setSnapshot(event.snapshot);
          setVariables(event.snapshot.variables);
          setStatements(event.snapshot.statements);
          log(
            `Paused before line ${event.snapshot.line}. ${event.snapshot.statements} statements executed.`,
          );
        }
        if (event.type === 'completed') {
          setStatus('completed');
          setOutput(event.output);
          setVariables(event.variables);
          setDuration(event.durationMs);
          setStatements(event.statements);
          setSnapshot(undefined);
          log(
            `Execution finished in ${event.durationMs.toFixed(0)} ms (${event.statements} statements).`,
          );
        }
        if (event.type === 'stopped') {
          setStatus('stopped');
          setSnapshot(undefined);
          log(event.reason);
        }
        if (event.type === 'error') {
          setStatus('error');
          setSnapshot(undefined);
          log(`Runtime error${event.line ? ` at line ${event.line}` : ''}: ${event.message}`);
          setOutput((text) => `${text}${text ? '\n\n' : ''}Runtime error: ${event.message}`);
          if (event.line && request.current) {
            setCheckedSource(request.current.source);
            setCheckedName(request.current.name);
            setDiagnostics([
              { severity: 'error', message: event.message, line: event.line, column: 1 },
            ]);
          }
          notifyRef.current(event.message, 'error');
        }
      }),
    [],
  );
  const check = async (name: string, source: string) => {
    setChecking(true);
    try {
      const result = await window.desktop.check(source);
      setDiagnostics(result.diagnostics);
      setCheckedSource(source);
      setCheckedName(name);
      return result;
    } finally {
      setChecking(false);
    }
  };
  const start = async (next: RunRequest) => {
    request.current = next;
    setOutput('');
    setVariables([]);
    setSnapshot(undefined);
    setDuration(undefined);
    setStatements(0);
    setRunName(next.name);
    setStatus('running');
    setDebugLog([`${next.debug ? 'Debugger' : 'Interpreter'} started for ${next.name}.`]);
    try {
      await window.desktop.run(next);
    } catch (e) {
      setStatus('error');
      throw e;
    }
  };
  const stop = async () => {
    await window.desktop.stop();
  };
  const debug = async (command: 'continue' | 'stepOver' | 'stepInto') => {
    if (status !== 'paused') return;
    setSnapshot(undefined);
    setStatus('running');
    log(
      command === 'continue'
        ? 'Continuing execution.'
        : command === 'stepInto'
          ? 'Step into next statement.'
          : 'Step over next statement.',
    );
    try {
      await window.desktop.debug(command);
    } catch (e) {
      setStatus('error');
      throw e;
    }
  };
  return {
    status,
    output,
    variables,
    snapshot,
    diagnostics,
    checkedSource,
    checkedName,
    checking,
    runName,
    duration,
    statements,
    debugLog,
    check,
    start,
    stop,
    debug,
    clear: () => setOutput(''),
  };
}
