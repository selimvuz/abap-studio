import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  FileCode2,
  FilePlus2,
  FolderOpen,
  MoreHorizontal,
  Search,
  Terminal,
} from 'lucide-react';
import type { ProgramFile } from '../../../packages/shared/src/index.js';
import type { OpenDocument } from './useWorkspace';
export function Sidebar({
  programs,
  documents,
  active,
  version,
  onOpen,
  onNew,
  onImport,
  onContext,
}: {
  programs: ProgramFile[];
  documents: OpenDocument[];
  active: string;
  version: string;
  onOpen: (program: ProgramFile) => void;
  onNew: () => void;
  onImport: () => void;
  onContext: (action: 'rename' | 'duplicate' | 'delete' | 'export', program: ProgramFile) => void;
}) {
  const [filter, setFilter] = useState(''),
    [menu, setMenu] = useState(''),
    [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 }),
    menuRef = useRef<HTMLDivElement>(null);
  const openMenu = (name: string, x: number, y: number) => {
    setMenuPosition({
      top: Math.min(y, window.innerHeight - 175),
      left: Math.max(10, Math.min(x, window.innerWidth - 170)),
    });
    setMenu(name);
  };
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu('');
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu('');
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [menu]);
  const filtered = programs.filter((program) =>
    program.name.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <span>Programs</span>
        <div>
          <button
            className="icon-button"
            title="Open .abap file"
            aria-label="Open program file"
            onClick={onImport}
          >
            <FolderOpen size={15} />
          </button>
          <button
            className="icon-button"
            title="New program"
            aria-label="New program"
            onClick={onNew}
          >
            <FilePlus2 size={15} />
          </button>
        </div>
      </div>
      <div className="program-search">
        <Search size={13} />
        <input
          aria-label="Filter programs"
          placeholder="Find a program…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <kbd>⌕</kbd>
      </div>
      <div className="workspace-label">
        <ChevronDown size={12} />
        <span>LOCAL WORKSPACE</span>
        <span>{programs.length}</span>
      </div>
      <div className="program-list" data-testid="program-list">
        {filtered.map((program) => (
          <div
            className={`program-row ${active === program.name ? 'active' : ''}`}
            key={program.name}
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu(program.name, e.clientX, e.clientY);
            }}
          >
            <button
              className="program-button"
              data-testid="program-list-item"
              data-program={program.name}
              aria-label={`Open ${program.name}`}
              onClick={() => onOpen(program)}
            >
              <FileCode2 size={15} />
              <span>{program.name}</span>
              {documents.some(
                (doc) => doc.name === program.name && doc.source !== doc.savedSource,
              ) && <span className="dirty-dot" title="Unsaved changes" />}
            </button>
            <button
              className="program-more icon-button"
              aria-label={`More actions for ${program.name}`}
              onClick={(event) => {
                if (menu === program.name) setMenu('');
                else {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  openMenu(program.name, bounds.right - 156, bounds.bottom + 3);
                }
              }}
            >
              <MoreHorizontal size={15} />
            </button>
            {menu === program.name && (
              <div
                className="program-context"
                style={{
                  position: 'fixed',
                  top: menuPosition.top,
                  left: menuPosition.left,
                  right: 'auto',
                }}
                ref={menuRef}
                role="menu"
              >
                {(['rename', 'duplicate', 'export', 'delete'] as const).map((action) => (
                  <button
                    className={action === 'delete' ? 'danger' : ''}
                    role="menuitem"
                    key={action}
                    onClick={() => {
                      setMenu('');
                      onContext(action, program);
                    }}
                  >
                    {action === 'export'
                      ? 'Export .abap…'
                      : `${action[0].toUpperCase()}${action.slice(1)}${action === 'delete' ? '' : '…'}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {!filtered.length && (
          <div className="sidebar-empty">
            {filter ? 'No programs found.' : 'Your next idea starts here.'}
            {!filter && <button onClick={onNew}>Create a program</button>}
          </div>
        )}
      </div>
      <div className="sidebar-foot">
        <div className="runtime-icon">
          <Terminal size={15} />
        </div>
        <div>
          <span>Local interpreter</span>
          <small>ABAP Studio {version}</small>
        </div>
        <i title="Running offline" />
      </div>
    </aside>
  );
}
