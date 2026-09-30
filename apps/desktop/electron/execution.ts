import { Worker } from 'node:worker_threads';
import type {
  CheckResult,
  RunRequest,
  RuntimeEvent,
  Settings,
} from '../../../packages/shared/src/index';
import { normalizeProgramName, validateSource } from './storage';

export function validateRunRequest(value: unknown): RunRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid execution request.');
  const input = value as Record<string, unknown>;
  const parameters: Record<string, string> = {};
  if (
    input.parameters &&
    typeof input.parameters === 'object' &&
    !Array.isArray(input.parameters)
  ) {
    for (const [name, text] of Object.entries(input.parameters)) {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name) ||
        typeof text !== 'string' ||
        text.length > 10_000
      )
        throw new Error('Invalid selection parameter.');
      if (Object.keys(parameters).length >= 100) throw new Error('Too many selection parameters.');
      Object.defineProperty(parameters, name, { value: text, enumerable: true });
    }
  }
  return {
    name: normalizeProgramName(input.name),
    source: validateSource(input.source),
    debug: input.debug === true,
    breakpoints: Array.isArray(input.breakpoints)
      ? [
          ...new Set(
            input.breakpoints.filter(
              (line): line is number =>
                typeof line === 'number' &&
                Number.isSafeInteger(line) &&
                line > 0 &&
                line <= 100_000,
            ),
          ),
        ].slice(0, 1_000)
      : [],
    parameters,
  };
}

/** Owns exactly one execution worker. Terminating it cannot strand the next run. */
export class ExecutionController {
  private worker?: Worker;
  private timer?: ReturnType<typeof setTimeout>;
  private remainingMs = 0;
  private resumedAt = 0;
  private paused = false;
  private generation = 0;
  private analysisQueue: Promise<unknown> = Promise.resolve();
  private analysisWorker?: Worker;
  private pendingAnalysis = 0;
  private disposed = false;

  constructor(
    private readonly workerPath: string,
    private readonly emit: (event: RuntimeEvent) => void,
  ) {}

  async run(input: unknown, settings: Settings): Promise<void> {
    if (this.disposed) throw new Error('Execution service is closed.');
    const request = validateRunRequest(input);
    const token = ++this.generation;
    await this.stopWorker();
    if (token !== this.generation) return;
    const worker = new Worker(this.workerPath, {
      workerData: { operation: 'run', source: request.source, request, settings },
      resourceLimits: {
        maxOldGenerationSizeMb: settings.memoryLimitMb,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    this.worker = worker;
    this.remainingMs = settings.timeoutMs;
    this.paused = false;
    this.startDeadline(worker);
    worker.on('message', (event: RuntimeEvent) => {
      if (this.worker !== worker) return;
      if (event.type === 'paused') {
        this.remainingMs = Math.max(1, this.remainingMs - (performance.now() - this.resumedAt));
        this.clearDeadline();
        this.paused = true;
      }
      this.emit(event);
      if (event.type === 'completed' || event.type === 'error') void this.finish(worker);
    });
    worker.on('error', (failure: unknown) => {
      if (this.worker !== worker) return;
      const error = failure instanceof Error ? failure : new Error(String(failure));
      this.emit({
        type: 'error',
        message: error.message.includes('memory')
          ? 'Program exceeded the worker memory limit.'
          : error.message,
      });
      void this.finish(worker);
    });
    worker.on('exit', (code) => {
      if (this.worker !== worker) return;
      this.emit({ type: 'error', message: `Execution worker exited unexpectedly (code ${code}).` });
      void this.finish(worker);
    });
  }

  async stop(reason = 'Program stopped.'): Promise<void> {
    ++this.generation;
    const wasRunning = !!this.worker;
    await this.stopWorker();
    if (wasRunning) this.emit({ type: 'stopped', reason });
  }

  debug(command: unknown): void {
    if (command !== 'continue' && command !== 'stepOver' && command !== 'stepInto')
      throw new Error('Unknown debugger command.');
    if (!this.worker || !this.paused) return;
    this.paused = false;
    this.startDeadline(this.worker);
    this.worker.postMessage({ command });
  }

  check(source: unknown): Promise<CheckResult> {
    return this.analyze('check', source) as Promise<CheckResult>;
  }
  format(source: unknown): Promise<string> {
    return this.analyze('format', source) as Promise<string>;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stop();
    await this.analysisWorker?.terminate();
  }

  private analyze(operation: 'check' | 'format', input: unknown): Promise<CheckResult | string> {
    const source = validateSource(input);
    if (this.disposed) return Promise.reject(new Error('Language service is closed.'));
    if (this.pendingAnalysis >= 4)
      return Promise.reject(new Error('Language service is busy. Please try again shortly.'));
    ++this.pendingAnalysis;
    const next = this.analysisQueue
      .catch(() => undefined)
      .then(
        () =>
          new Promise<CheckResult | string>((resolve, reject) => {
            if (this.disposed) {
              reject(new Error('Language service is closed.'));
              return;
            }
            const worker = new Worker(this.workerPath, {
              workerData: { operation, source },
              resourceLimits: {
                maxOldGenerationSizeMb: 128,
                maxYoungGenerationSizeMb: 16,
                stackSizeMb: 4,
              },
            });
            this.analysisWorker = worker;
            let completed = false;
            const cleanup = () => {
              clearTimeout(deadline);
              if (this.analysisWorker === worker) this.analysisWorker = undefined;
              void worker.terminate();
            };
            const finish = (error?: Error, result?: CheckResult | string) => {
              if (completed) return;
              completed = true;
              cleanup();
              if (error) reject(error);
              else resolve(result!);
            };
            const deadline = setTimeout(
              () => finish(new Error('Language analysis timed out. Try a smaller program.')),
              5_000,
            );
            worker.on('message', (message: { result?: CheckResult | string; error?: string }) =>
              finish(message.error ? new Error(message.error) : undefined, message.result),
            );
            worker.on('error', (error: unknown) =>
              finish(error instanceof Error ? error : new Error(String(error))),
            );
            worker.on('exit', (code) => {
              if (!completed) finish(new Error(`Language worker exited (code ${code}).`));
            });
          }),
      )
      .finally(() => {
        --this.pendingAnalysis;
      });
    this.analysisQueue = next;
    return next;
  }

  private startDeadline(worker: Worker): void {
    this.clearDeadline();
    this.resumedAt = performance.now();
    this.timer = setTimeout(
      () => {
        if (this.worker !== worker) return;
        this.emit({
          type: 'error',
          message: 'Execution timed out. Adjust the limit in Settings if needed.',
        });
        void this.finish(worker);
      },
      Math.max(1, this.remainingMs),
    );
  }
  private clearDeadline(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private async finish(worker: Worker): Promise<void> {
    if (this.worker === worker) await this.stopWorker();
  }
  private async stopWorker(): Promise<void> {
    this.clearDeadline();
    const worker = this.worker;
    this.worker = undefined;
    this.paused = false;
    if (worker) await worker.terminate();
  }
}
