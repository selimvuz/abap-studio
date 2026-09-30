import { useEffect, useRef, useState } from 'react';
import { ArrowUpDown, Command, FileCode2, Search } from 'lucide-react';
export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  run: () => void;
}
export function CommandPalette({
  mode,
  items,
  onClose,
}: {
  mode: 'commands' | 'programs';
  items: PaletteItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState(0),
    input = useRef<HTMLInputElement>(null);
  const filtered = items.filter((item) =>
    `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => setSelected(0), [query]);
  const execute = (item: PaletteItem) => {
    onClose();
    item.run();
  };
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label={mode === 'commands' ? 'Command palette' : 'Quick open'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette-input">
          {mode === 'commands' ? <Command size={18} /> : <Search size={18} />}
          <input
            ref={input}
            aria-label={mode === 'commands' ? 'Search commands' : 'Search programs'}
            placeholder={mode === 'commands' ? 'What would you like to do?' : 'Go to a program…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelected((index) => Math.min(index + 1, filtered.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected((index) => Math.max(0, index - 1));
              }
              if (e.key === 'Enter' && filtered[selected]) execute(filtered[selected]);
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-section">
          {mode === 'commands' ? 'COMMANDS' : 'WORKSPACE & RECENT PROGRAMS'}
        </div>
        <div className="palette-results" role="listbox">
          {filtered.map((item, index) => (
            <button
              key={item.id}
              role="option"
              aria-selected={selected === index}
              className={`palette-item ${selected === index ? 'selected' : ''}`}
              onMouseEnter={() => setSelected(index)}
              onClick={() => execute(item)}
            >
              {mode === 'commands' ? <Command size={15} /> : <FileCode2 size={15} />}
              <span>
                {item.label}
                {item.detail && <small>{item.detail}</small>}
              </span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          ))}
          {!filtered.length && (
            <p className="empty-copy">
              No {mode === 'commands' ? 'commands' : 'programs'} match “{query}”.
            </p>
          )}
        </div>
        <div className="palette-footer">
          <ArrowUpDown size={12} />
          <span>to navigate</span>
          <kbd>↵</kbd>
          <span>to open</span>
        </div>
      </div>
    </div>
  );
}
