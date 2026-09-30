import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Diagnostic, Settings } from '../../../packages/shared/src/index.js';
import { monaco } from './language';

export interface EditorHandle {
  focus(): void;
  goTo(line: number, column?: number): void;
  action(id: string): void;
}
interface Props {
  name: string;
  source: string;
  theme: Settings['theme'];
  fontSize: number;
  minimap: boolean;
  diagnostics: Diagnostic[];
  breakpoints: number[];
  currentLine?: number;
  readOnly: boolean;
  onChange(source: string): void;
  onPosition(line: number, column: number): void;
  onBreakpoint(line: number): void;
  onBreakpointLines(lines: number[]): void;
}
export const CodeEditor = forwardRef<EditorHandle, Props>(function CodeEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const latest = useRef(props);
  latest.current = props;
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const currentDecoration = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const currentName = useRef('');
  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor.current?.focus(),
      goTo: (line, column = 1) => {
        editor.current?.revealLineInCenter(line);
        editor.current?.setPosition({ lineNumber: line, column });
        editor.current?.focus();
      },
      action: (id) => {
        void editor.current?.getAction(id)?.run();
      },
    }),
    [],
  );
  useEffect(() => {
    const instance = monaco.editor.create(host.current!, {
      model: null,
      language: 'abap',
      ariaLabel: 'ABAP source editor',
      editContext: false,
      theme: `studio-${latest.current.theme}`,
      automaticLayout: true,
      fontFamily: '"Cascadia Code", "Consolas", "Courier New", monospace',
      fontSize: latest.current.fontSize,
      lineHeight: 25,
      fontLigatures: true,
      tabSize: 2,
      insertSpaces: true,
      glyphMargin: true,
      minimap: { enabled: latest.current.minimap, renderCharacters: false, maxColumn: 80 },
      padding: { top: 20, bottom: 28 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      cursorBlinking: 'smooth',
      renderLineHighlight: 'line',
      overviewRulerBorder: false,
      lineNumbersMinChars: 4,
      folding: true,
      showFoldingControls: 'mouseover',
      bracketPairColorization: { enabled: true },
      stickyScroll: { enabled: false },
      wordWrap: 'off',
      contextmenu: true,
      scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9, useShadows: false },
    });
    editor.current = instance;
    decorations.current = instance.createDecorationsCollection();
    currentDecoration.current = instance.createDecorationsCollection();
    const change = instance.onDidChangeModelContent(() => {
      const value = instance.getValue();
      if (value !== latest.current.source) latest.current.onChange(value);
      const lines = [
        ...new Set(decorations.current?.getRanges().map((range) => range.startLineNumber) ?? []),
      ].sort((a, b) => a - b);
      if (lines.join(',') !== latest.current.breakpoints.join(','))
        latest.current.onBreakpointLines(lines);
    });
    const position = instance.onDidChangeCursorPosition((event) =>
      latest.current.onPosition(event.position.lineNumber, event.position.column),
    );
    const mouse = instance.onMouseDown((event) => {
      if (
        event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        event.target.position
      )
        latest.current.onBreakpoint(event.target.position.lineNumber);
    });
    // Own the application shortcuts instead of Monaco's conflicting editor defaults.
    const commands: Array<[number, string]> = [
      [monaco.KeyCode.F8, 'run'],
      [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F2, 'check'],
      [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, 'save'],
      [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, 'saveAs'],
      [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, 'format'],
      [monaco.KeyCode.F5, 'debug'],
      [monaco.KeyCode.F10, 'stepOver'],
      [monaco.KeyCode.F11, 'stepInto'],
      [monaco.KeyMod.Shift | monaco.KeyCode.F5, 'stop'],
      [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, 'quickOpen'],
      [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, 'commandPalette'],
    ];
    for (const [key, action] of commands)
      instance.addCommand(key, () =>
        window.dispatchEvent(new CustomEvent('studio-command', { detail: action })),
      );
    return () => {
      change.dispose();
      position.dispose();
      mouse.dispose();
      instance.dispose();
      models.current.forEach((model) => model.dispose());
      models.current.clear();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    if (currentName.current !== props.name) {
      if (currentName.current)
        viewStates.current.set(currentName.current, instance.saveViewState());
      let model = models.current.get(props.name);
      if (!model) {
        model = monaco.editor.createModel(
          props.source,
          'abap',
          monaco.Uri.parse(`inmemory://programs/${encodeURIComponent(props.name)}.abap`),
        );
        models.current.set(props.name, model);
      } else if (model.getValue() !== props.source) model.setValue(props.source);
      currentName.current = props.name;
      instance.setModel(model);
      const view = viewStates.current.get(props.name);
      if (view) instance.restoreViewState(view);
      instance.focus();
    } else if (instance.getValue() !== props.source)
      instance.executeEdits('studio', [
        { range: instance.getModel()!.getFullModelRange(), text: props.source },
      ]);
  }, [props.name, props.source]);
  useEffect(() => {
    monaco.editor.setTheme(`studio-${props.theme}`);
    editor.current?.updateOptions({
      fontSize: props.fontSize,
      minimap: { enabled: props.minimap },
      readOnly: props.readOnly,
    });
  }, [props.theme, props.fontSize, props.minimap, props.readOnly]);
  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      'abap',
      props.diagnostics.map((diagnostic) => ({
        severity:
          diagnostic.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
        message: diagnostic.message,
        startLineNumber: diagnostic.line,
        startColumn: diagnostic.column,
        endLineNumber: diagnostic.endLine ?? diagnostic.line,
        endColumn: diagnostic.endColumn ?? diagnostic.column + 1,
      })),
    );
  }, [props.diagnostics, props.name]);
  useEffect(() => {
    const items: monaco.editor.IModelDeltaDecoration[] = props.breakpoints.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        glyphMarginClassName: 'studio-breakpoint',
        glyphMarginHoverMessage: { value: 'Breakpoint · click to remove' },
      },
    }));
    decorations.current?.set(items);
    currentDecoration.current?.set(
      props.currentLine
        ? [
            {
              range: new monaco.Range(props.currentLine, 1, props.currentLine, 1),
              options: {
                isWholeLine: true,
                className: 'studio-current-line',
                glyphMarginClassName: 'studio-current-arrow',
              },
            },
          ]
        : [],
    );
    if (props.currentLine) editor.current?.revealLineInCenterIfOutsideViewport(props.currentLine);
  }, [props.breakpoints, props.currentLine, props.name]);
  return (
    <div
      ref={host}
      className="code-editor"
      data-testid="code-editor"
      aria-label="ABAP source editor"
    />
  );
});
