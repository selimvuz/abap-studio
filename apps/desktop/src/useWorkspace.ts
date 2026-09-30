import { useEffect, useState } from 'react';
import type { ProgramFile, Settings } from '../../../packages/shared/src/index.js';
export interface OpenDocument {
  name: string;
  source: string;
  savedSource: string;
}
export type ConfirmChoice = 'save' | 'discard' | 'cancel';
const defaults: Settings = {
  theme: 'dark',
  fontSize: 14,
  minimap: true,
  timeoutMs: 5000,
  maxStatements: 100000,
  memoryLimitMb: 128,
  recent: [],
};
export function useWorkspace(
  confirm: (title: string, message: string) => Promise<ConfirmChoice>,
  notify: (message: string, tone?: 'error' | 'success') => void,
) {
  const [programs, setPrograms] = useState<ProgramFile[]>([]),
    [documents, setDocuments] = useState<OpenDocument[]>([]),
    [activeName, setActiveName] = useState('');
  const [settings, setSettings] = useState(defaults),
    [workspacePath, setWorkspacePath] = useState(''),
    [version, setVersion] = useState(''),
    [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const active = documents.find((doc) => doc.name === activeName);
  useEffect(() => {
    let live = true;
    window.desktop
      .bootstrap()
      .then((data) => {
        if (!live) return;
        setPrograms(data.programs);
        setSettings(data.settings);
        setWorkspacePath(data.workspacePath);
        setVersion(data.version);
        const first =
          data.programs.find((p) => p.name === data.settings.lastProgram) ?? data.programs[0];
        if (first) {
          setDocuments([{ name: first.name, source: first.source, savedSource: first.source }]);
          setActiveName(first.name);
        }
        setReady(true);
      })
      .catch((e) => {
        if (live) setError(String(e.message ?? e));
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(
    () => window.desktop.setDirty(documents.some((doc) => doc.source !== doc.savedSource)),
    [documents],
  );
  const persistSettings = async (patch: Partial<Settings>) => {
    const next = await window.desktop.updateSettings(patch);
    setSettings(next);
    return next;
  };
  const activate = (name: string) => {
    setActiveName(name);
    void persistSettings({
      lastProgram: name,
      recent: [name, ...settings.recent.filter((item) => item !== name)].slice(0, 12),
    }).catch((e) => notify(e.message, 'error'));
  };
  const open = (program: ProgramFile) => {
    setDocuments((docs) =>
      docs.some((doc) => doc.name === program.name)
        ? docs
        : [...docs, { name: program.name, source: program.source, savedSource: program.source }],
    );
    activate(program.name);
  };
  const update = (source: string) =>
    setDocuments((docs) => docs.map((doc) => (doc.name === activeName ? { ...doc, source } : doc)));
  const saveDocument = async (doc: OpenDocument) => {
    const saved = await window.desktop.saveProgram(doc.name, doc.source);
    setPrograms((items) =>
      [...items.filter((p) => p.name !== saved.name), saved].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
    setDocuments((docs) =>
      docs.map((d) => (d.name === doc.name ? { ...d, savedSource: doc.source } : d)),
    );
    return saved;
  };
  const save = async () => {
    if (active) {
      await saveDocument(active);
      notify(`${active.name} saved`, 'success');
    }
  };
  const ensureCanDiscard = async (doc: OpenDocument) => {
    if (doc.source === doc.savedSource) return true;
    const choice = await confirm(
      'Unsaved changes',
      `Save your changes to ${doc.name} before continuing?`,
    );
    if (choice === 'cancel') return false;
    if (choice === 'save') await saveDocument(doc);
    return true;
  };
  const close = async (name = activeName) => {
    const doc = documents.find((d) => d.name === name);
    if (!doc || !(await ensureCanDiscard(doc))) return;
    setDocuments((docs) => docs.filter((d) => d.name !== name));
    if (activeName === name) {
      const index = documents.findIndex((d) => d.name === name);
      setActiveName(documents[index - 1]?.name ?? documents[index + 1]?.name ?? '');
    }
  };
  const normalize = (name: string) =>
    name
      .trim()
      .replace(/\.abap$/i, '')
      .toUpperCase();
  const requireNew = (raw: string) => {
    const name = normalize(raw);
    if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(name))
      throw new Error(
        'Use a letter followed by letters, numbers or underscores (maximum 40 characters).',
      );
    if (programs.some((p) => p.name === name))
      throw new Error(`A program named ${name} already exists.`);
    return name;
  };
  const create = async (raw: string, source?: string) => {
    const name = requireNew(raw);
    const saved = await window.desktop.saveProgram(
      name,
      source ?? `REPORT ${name.toLowerCase()}.\n\nWRITE / 'Hello World'.\n`,
    );
    setPrograms((items) => [...items, saved].sort((a, b) => a.name.localeCompare(b.name)));
    open(saved);
    return saved;
  };
  const rename = async (oldName: string, raw: string) => {
    const name = normalize(raw);
    if (name === oldName) return;
    requireNew(name);
    const doc = documents.find((d) => d.name === oldName);
    if (doc && !(await ensureCanDiscard(doc))) return;
    const renamed = await window.desktop.renameProgram(oldName, name);
    setPrograms((items) =>
      items
        .map((p) => (p.name === oldName ? renamed : p))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setDocuments((docs) =>
      docs.map((d) =>
        d.name === oldName ? { name, source: renamed.source, savedSource: renamed.source } : d,
      ),
    );
    if (activeName === oldName) activate(name);
  };
  const remove = async (name: string) => {
    await window.desktop.deleteProgram(name);
    setPrograms((items) => items.filter((p) => p.name !== name));
    setDocuments((docs) => docs.filter((d) => d.name !== name));
    if (activeName === name) setActiveName(documents.find((d) => d.name !== name)?.name ?? '');
  };
  // Native import may replace any existing workspace file. Resolve all affected
  // in-memory edits before opening that dialog, not only the selected tab.
  const importProgram = async () => {
    for (const doc of documents) {
      if (!(await ensureCanDiscard(doc))) return;
    }
    const program = await window.desktop.openProgram();
    if (!program) return;
    const list = await window.desktop.listPrograms();
    setPrograms(list);
    setDocuments((docs) => [
      ...docs.filter((d) => d.name !== program.name),
      { name: program.name, source: program.source, savedSource: program.source },
    ]);
    activate(program.name);
  };
  return {
    programs,
    documents,
    active,
    activeName,
    settings,
    workspacePath,
    version,
    ready,
    error,
    open,
    update,
    save,
    close,
    create,
    rename,
    remove,
    importProgram,
    persistSettings,
  };
}
