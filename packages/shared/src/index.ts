/** Serializable contracts at the desktop / language-engine boundary. */
export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}
export interface Parameter {
  name: string;
  type: string;
  defaultValue: string;
}
export interface CheckResult {
  diagnostics: Diagnostic[];
  parameters: Parameter[];
}
export type DataValue =
  string | number | boolean | null | DataValue[] | { [key: string]: DataValue };
export interface Variable {
  name: string;
  type: string;
  value: DataValue;
}
export interface ExecutionSnapshot {
  line: number;
  variables: Variable[];
  statements: number;
}
export interface RunRequest {
  source: string;
  name: string;
  debug?: boolean;
  breakpoints?: number[];
  parameters?: Record<string, string>;
}
export type RuntimeEvent =
  | { type: 'output'; text: string }
  | { type: 'paused'; snapshot: ExecutionSnapshot }
  | {
      type: 'completed';
      output: string;
      variables: Variable[];
      statements: number;
      durationMs: number;
    }
  | { type: 'error'; message: string; line?: number }
  | { type: 'stopped'; reason: string };
export interface ProgramFile {
  name: string;
  source: string;
  updatedAt: string;
}
export interface Settings {
  theme: 'dark' | 'light';
  fontSize: number;
  minimap: boolean;
  timeoutMs: number;
  maxStatements: number;
  memoryLimitMb: number;
  recent: string[];
  lastProgram?: string;
}
export interface Bootstrap {
  programs: ProgramFile[];
  settings: Settings;
  workspacePath: string;
  version: string;
}
export interface DesktopAPI {
  bootstrap(): Promise<Bootstrap>;
  listPrograms(): Promise<ProgramFile[]>;
  saveProgram(name: string, source: string): Promise<ProgramFile>;
  renameProgram(oldName: string, newName: string): Promise<ProgramFile>;
  deleteProgram(name: string): Promise<void>;
  openProgram(): Promise<ProgramFile | null>;
  exportProgram(name: string, source: string): Promise<boolean>;
  updateSettings(settings: Partial<Settings>): Promise<Settings>;
  check(source: string): Promise<CheckResult>;
  format(source: string): Promise<string>;
  run(request: RunRequest): Promise<void>;
  stop(): Promise<void>;
  debug(command: 'continue' | 'stepOver' | 'stepInto'): Promise<void>;
  onRuntime(callback: (event: RuntimeEvent) => void): () => void;
  onMenu(callback: (action: string) => void): () => void;
  setDirty(dirty: boolean): void;
}
