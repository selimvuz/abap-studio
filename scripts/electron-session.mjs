import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

/** Attach to Electron's Chromium surface without relying on Node inspector internals. */
export async function launchDesktop(executable, args, env) {
  let logs = '';
  // Explicit opt-in for CI hosts that cannot create a nested Chromium token.
  // This script is excluded from the installed app; production security is unchanged.
  const testFlags =
    env.ABAP_STUDIO_TEST_NO_CHROMIUM_SANDBOX === '1' ? ['--no-sandbox', '--in-process-gpu'] : [];
  const child = spawn(
    executable,
    ['--remote-debugging-port=0', '--disable-gpu', ...testFlags, ...args],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const endpoint = await new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`Electron did not expose its test port.\n${logs}`)),
      30000,
    );
    const receive = (data) => {
      logs += data.toString();
      const match = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(deadline);
        resolve(match[1]);
      }
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.once('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(deadline);
      reject(new Error(`Electron exited (${code}).\n${logs}`));
    });
  });
  let browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
  } catch (error) {
    console.error(logs);
    child.kill();
    throw error;
  }
  const context = browser.contexts()[0];
  let page;
  try {
    page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 15000 }));
  } catch (error) {
    console.error(logs);
    await browser.close();
    child.kill();
    throw error;
  }
  return {
    page,
    browser,
    logs: () => logs,
    async close() {
      for (const p of context.pages()) await p.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      if (child.exitCode === null) child.kill();
    },
  };
}
