import { readFile, writeFile, mkdir } from 'node:fs/promises';

const packages = [
  'react',
  'react-dom',
  'scheduler',
  'monaco-editor',
  'lucide-react',
  'marked',
  'dompurify',
];
const notices = [
  'ABAP Studio — third-party notices',
  'The following libraries are included in the bundled desktop renderer. Their original notices are reproduced below. Electron and Chromium notices are distributed separately with the installed runtime.',
];
for (const name of packages) {
  const directory = `node_modules/${name}`;
  const metadata = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
  let license;
  for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try {
      license = await readFile(`${directory}/${candidate}`, 'utf8');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!license) throw new Error(`Missing required license notice for ${name}`);
  notices.push(`${'='.repeat(72)}\n${name} ${metadata.version}\n${'='.repeat(72)}\n\n${license}`);
}
notices.push(
  'Monaco — additional third-party notices\n\n' +
    (await readFile('node_modules/monaco-editor/ThirdPartyNotices.txt', 'utf8')),
);
await mkdir('docs', { recursive: true });
await writeFile('docs/THIRD-PARTY-NOTICES.txt', notices.join('\n\n') + '\n');
