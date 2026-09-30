import { Menu, type MenuItemConstructorOptions } from 'electron';

export function installApplicationMenu(send: (action: string) => void): void {
  const item = (
    label: string,
    action: string,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({ label, accelerator, click: () => send(action) });
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '&File',
        submenu: [
          item('New Program', 'new', 'CmdOrCtrl+N'),
          item('Open Program…', 'open', 'CmdOrCtrl+O'),
          item('Quick Open…', 'quickOpen', 'CmdOrCtrl+P'),
          separator,
          item('Save', 'save', 'CmdOrCtrl+S'),
          item('Save As…', 'saveAs', 'CmdOrCtrl+Shift+S'),
          item('Close Program', 'close', 'CmdOrCtrl+W'),
          separator,
          { role: 'quit', label: 'Exit' },
        ],
      },
      {
        label: '&Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          separator,
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          separator,
          item('Find', 'find', 'CmdOrCtrl+F'),
          item('Replace', 'replace', 'CmdOrCtrl+H'),
          item('Format Document', 'format', 'CmdOrCtrl+Shift+F'),
          separator,
          item('Settings…', 'settings', 'CmdOrCtrl+,'),
        ],
      },
      {
        label: '&Program',
        submenu: [item('Check Program', 'check', 'CmdOrCtrl+F2'), item('Pretty Printer', 'format')],
      },
      {
        label: '&Run',
        submenu: [item('Run Program', 'run', 'F8'), item('Stop Program', 'stop', 'Shift+F8')],
      },
      {
        label: '&Debug',
        submenu: [
          item('Start Debugging', 'debug', 'F5'),
          item('Continue', 'continue', 'CmdOrCtrl+F5'),
          separator,
          item('Step Over', 'stepOver', 'F10'),
          item('Step Into', 'stepInto', 'F11'),
          separator,
          item('Stop Debugging', 'stop', 'Shift+F5'),
        ],
      },
      {
        label: '&View',
        submenu: [
          item('Toggle Programs Panel', 'togglePrograms', 'CmdOrCtrl+B'),
          item('Toggle Output', 'toggleOutput', 'CmdOrCtrl+J'),
          item('Toggle Problems', 'toggleProblems'),
          item('Toggle Variables', 'toggleVariables'),
          separator,
          item('Command Palette…', 'commandPalette', 'CmdOrCtrl+Shift+P'),
          item('Switch Color Theme', 'theme'),
          separator,
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
          separator,
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: '&Help',
        submenu: [item('Documentation', 'documentation', 'F1'), item('About ABAP Studio', 'about')],
      },
    ]),
  );
}
