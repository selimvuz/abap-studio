import { parentPort, workerData } from 'node:worker_threads';
import { checkProgram, formatProgram } from '../../../packages/abap-language-service/src/index';
import { executeProgram } from '../../../packages/abap-runtime/src/index';
import type {
  ExecutionSnapshot,
  RunRequest,
  RuntimeEvent,
  Settings,
} from '../../../packages/shared/src/index';

interface WorkerRequest {
  operation: 'run' | 'check' | 'format';
  source: string;
  request?: RunRequest;
  settings?: Settings;
}
const data = workerData as WorkerRequest;
const port = parentPort;
if (!port) throw new Error('The execution worker must be launched in a worker thread.');

async function run(): Promise<void> {
  if (data.operation === 'check') {
    port!.postMessage({ result: checkProgram(data.source) });
    return;
  }
  if (data.operation === 'format') {
    port!.postMessage({ result: formatProgram(data.source) });
    return;
  }

  const request = data.request!;
  const settings = data.settings!;
  const breakpoints = new Set(request.breakpoints ?? []);
  let stepNext = !!request.debug;
  let resume: (() => void) | undefined;
  let bufferedOutput = '';
  let outputBytes = 0;
  const startedAt = performance.now();
  const send = (event: RuntimeEvent) => port!.postMessage(event);
  const flushOutput = () => {
    if (bufferedOutput) {
      send({ type: 'output', text: bufferedOutput });
      bufferedOutput = '';
    }
  };
  const flushInterval = setInterval(flushOutput, 32);
  port!.on('message', (message: { command?: string }) => {
    if (!resume || !['continue', 'stepOver', 'stepInto'].includes(message.command ?? '')) return;
    // Without methods, both stepping commands advance one interpreted statement.
    stepNext = message.command !== 'continue';
    const release = resume;
    resume = undefined;
    release();
  });

  try {
    const checked = checkProgram(data.source);
    const error = checked.diagnostics.find((item) => item.severity === 'error');
    if (error) {
      send({ type: 'error', message: error.message, line: error.line });
      return;
    }
    const result = await executeProgram(data.source, {
      parameters: request.parameters,
      maxStatements: settings.maxStatements,
      // The parent owns an active-time deadline and suspends it while paused.
      timeoutMs: request.debug ? Number.MAX_SAFE_INTEGER : settings.timeoutMs,
      onOutput: (text) => {
        outputBytes += Buffer.byteLength(text, 'utf8');
        if (outputBytes > 2_097_152) throw new Error('Output exceeded the 2 MB safety limit.');
        bufferedOutput += text;
        if (bufferedOutput.length >= 16_384) flushOutput();
      },
      onStatement: request.debug
        ? async (snapshot: ExecutionSnapshot) => {
            if (!stepNext && !breakpoints.has(snapshot.line)) return;
            stepNext = false;
            flushOutput();
            await new Promise<void>((resolve) => {
              resume = resolve;
              send({ type: 'paused', snapshot });
            });
          }
        : undefined,
    });
    flushOutput();
    send({ type: 'completed', ...result, durationMs: Math.round(performance.now() - startedAt) });
  } finally {
    clearInterval(flushInterval);
    flushOutput();
    port!.removeAllListeners('message');
  }
}

void run()
  .catch((error: unknown) => {
    const failure = error as { message?: string; line?: number; location?: { line?: number } };
    if (data.operation === 'run')
      port.postMessage({
        type: 'error',
        message: failure.message ?? String(error),
        line: failure.line ?? failure.location?.line,
      });
    else port.postMessage({ error: failure.message ?? String(error) });
  })
  .finally(() => port.close());
