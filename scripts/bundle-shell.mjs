import { build } from 'rolldown';
export async function bundleShell() {
  // Separate bundles keep the sandboxed preload and unpacked worker self-contained.
  for (const name of ['main', 'preload', 'execution-worker']) {
    await build({
      input: `apps/desktop/electron/${name}.ts`,
      platform: 'node',
      external: ['electron'],
      output: {
        file: `dist-electron/${name}.cjs`,
        format: 'cjs',
        sourcemap: true,
        codeSplitting: false,
      },
    });
  }
}
