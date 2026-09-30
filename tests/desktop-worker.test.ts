import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'rolldown';
import { ExecutionController, validateRunRequest } from '../apps/desktop/electron/execution';
import { DEFAULT_SETTINGS } from '../apps/desktop/electron/storage';
import type { RuntimeEvent } from '../packages/shared/src/index';

let directory: string;
let workerPath: string;
const controllers: ExecutionController[] = [];
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'abap-worker-test-'));
  workerPath = path.join(directory, 'worker.cjs');
  await build({
    input: path.resolve('apps/desktop/electron/execution-worker.ts'),
    platform: 'node',
    output: { file: workerPath, format: 'cjs' },
    logLevel: 'silent',
  });
});
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.dispose()));
});
afterAll(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

function harness(customWorkerPath = workerPath) {
  const events: RuntimeEvent[] = [];
  const listeners = new Set<() => void>();
  const controller = new ExecutionController(customWorkerPath, (event) => {
    events.push(event);
    for (const listener of listeners) listener();
  });
  controllers.push(controller);
  const next = <T extends RuntimeEvent['type']>(
    type: T,
    after = 0,
  ): Promise<Extract<RuntimeEvent, { type: T }>> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`Timed out waiting for ${type}; received ${JSON.stringify(events)}`));
      }, 5_000);
      const check = () => {
        const event = events.slice(after).find((event) => event.type === type);
        if (!event) return;
        clearTimeout(timer);
        listeners.delete(check);
        resolve(event as Extract<RuntimeEvent, { type: T }>);
      };
      listeners.add(check);
      check();
    });
  return { controller, events, next };
}

describe('isolated desktop execution', () => {
  it('runs the Hello World milestone and checks/formats in language workers', async () => {
    const { controller, next, events } = harness();
    const source = 'REPORT zhello_world.\nDATA(lv_name) = `World`.\nWRITE |Hello { lv_name }|.';
    const checked = await controller.check(source);
    expect(checked.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(await controller.format(source)).toContain('WRITE');
    await controller.run({ source, name: 'ZHELLO_WORLD' }, DEFAULT_SETTINGS);
    const completed = await next('completed');
    expect(completed.output.trim()).toBe('Hello World');
    expect(
      events
        .filter((event) => event.type === 'output')
        .map((event) => event.text)
        .join('')
        .trim(),
    ).toBe('Hello World');
  });

  it('pauses before statements, steps, visits breakpoints, and inspects values', async () => {
    const { controller, next, events } = harness();
    await controller.run(
      {
        name: 'ZDEBUG',
        source: 'DATA(lv_number) = 1.\nlv_number = 2.\nWRITE lv_number.',
        debug: true,
        breakpoints: [3],
      },
      DEFAULT_SETTINGS,
    );
    expect((await next('paused')).snapshot.line).toBe(1);
    const stepStart = events.length;
    controller.debug('stepInto');
    const second = await next('paused', stepStart);
    expect(second.snapshot.line).toBe(2);
    expect(
      second.snapshot.variables.find((variable) => variable.name.toUpperCase() === 'LV_NUMBER')
        ?.value,
    ).toBe(1);
    const continueStart = events.length;
    controller.debug('continue');
    expect((await next('paused', continueStart)).snapshot.line).toBe(3);
    controller.debug('stepOver');
    expect((await next('completed')).output.trim()).toBe('2');
  });

  it('stops a paused worker and starts a fresh execution', async () => {
    const { controller, next, events } = harness();
    await controller.run({ name: 'ZLOOP', source: 'DO.\nENDDO.', debug: true }, DEFAULT_SETTINGS);
    await next('paused');
    await controller.stop();
    expect((await next('stopped')).reason).toContain('stopped');
    const start = events.length;
    await controller.run({ name: 'ZFRESH', source: 'WRITE `Fresh`.' }, DEFAULT_SETTINGS);
    expect((await next('completed', start)).output).toBe('Fresh');
  });

  it('enforces the statement limit for an empty infinite loop', async () => {
    const { controller, next } = harness();
    await controller.run(
      { name: 'ZLOOP', source: 'DO.\nENDDO.' },
      { ...DEFAULT_SETTINGS, maxStatements: 200 },
    );
    expect((await next('error')).message.toLowerCase()).toMatch(/statement|limit|budget/);
  });

  it('terminates a non-cooperative worker at its external deadline and restarts', async () => {
    const frozenPath = path.join(directory, 'frozen.cjs');
    await fs.writeFile(
      frozenPath,
      'const {parentPort,workerData}=require("node:worker_threads"); if(workerData.source==="freeze") {while(true){}} else {parentPort.postMessage({type:"completed",output:"Recovered",variables:[],statements:1,durationMs:1})}',
    );
    const { controller, next, events } = harness(frozenPath);
    await controller.run(
      { name: 'ZFROZEN', source: 'freeze' },
      { ...DEFAULT_SETTINGS, timeoutMs: 100 },
    );
    expect((await next('error')).message).toContain('timed out');
    await controller.stop();
    const start = events.length;
    await controller.run({ name: 'ZRECOVERED', source: '' }, DEFAULT_SETTINGS);
    expect((await next('completed', start)).output).toBe('Recovered');
  });

  it('suspends the external deadline while the debugger waits for the user', async () => {
    const { controller, next, events } = harness();
    await controller.run(
      { name: 'ZPAUSE', source: 'WRITE `Ready`.', debug: true },
      { ...DEFAULT_SETTINGS, timeoutMs: 500 },
    );
    await next('paused');
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(events.some((event) => event.type === 'error')).toBe(false);
    controller.debug('continue');
    expect((await next('completed')).output).toBe('Ready');
  });

  it('validates all renderer-controlled execution values', () => {
    expect(() => validateRunRequest({ name: '../evil', source: 'WRITE 1.' })).toThrow();
    expect(() =>
      validateRunRequest({
        name: 'ZTEST',
        source: 'WRITE 1.',
        parameters: { a: { nested: true } },
      }),
    ).toThrow();
    expect(
      validateRunRequest({ name: 'ZTEST', source: '', breakpoints: [-1, 2, 2, '3', 1.2] })
        .breakpoints,
    ).toEqual([2]);
  });
});
