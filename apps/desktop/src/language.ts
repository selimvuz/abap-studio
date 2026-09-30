import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget.js';
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/format/browser/formatActions.js';
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js';
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution.js';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';

window.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const keywords = [
  'REPORT',
  'PROGRAM',
  'DATA',
  'FINAL',
  'TYPES',
  'CONSTANTS',
  'TYPE',
  'LIKE',
  'VALUE',
  'LENGTH',
  'DECIMALS',
  'BEGIN',
  'END',
  'OF',
  'STANDARD',
  'SORTED',
  'HASHED',
  'TABLE',
  'WITH',
  'EMPTY',
  'KEY',
  'UNIQUE',
  'NON-UNIQUE',
  'IF',
  'ELSEIF',
  'ELSE',
  'ENDIF',
  'CASE',
  'WHEN',
  'OTHERS',
  'ENDCASE',
  'DO',
  'TIMES',
  'ENDDO',
  'WHILE',
  'ENDWHILE',
  'LOOP',
  'AT',
  'INTO',
  'ASSIGNING',
  'WHERE',
  'ENDLOOP',
  'CHECK',
  'CONTINUE',
  'EXIT',
  'RETURN',
  'WRITE',
  'CLEAR',
  'FREE',
  'MOVE',
  'TO',
  'APPEND',
  'INSERT',
  'MODIFY',
  'DELETE',
  'READ',
  'INDEX',
  'SORT',
  'BY',
  'ASCENDING',
  'DESCENDING',
  'INITIAL',
  'IS',
  'NOT',
  'AND',
  'OR',
  'DIV',
  'MOD',
  'EQ',
  'NE',
  'GT',
  'LT',
  'GE',
  'LE',
  'CONCATENATE',
  'SEPARATED',
  'SPLIT',
  'CONDENSE',
  'NO-GAPS',
  'PARAMETERS',
  'DEFAULT',
  'INITIALIZATION',
  'START-OF-SELECTION',
  'END-OF-SELECTION',
  'CONV',
  'COND',
  'SWITCH',
  'CORRESPONDING',
  'NEW',
  'REF',
  'REDUCE',
  'FILTER',
  'FOR',
  'LET',
  'CLASS',
  'DEFINITION',
  'IMPLEMENTATION',
  'ENDCLASS',
  'METHOD',
  'METHODS',
  'ENDMETHOD',
  'CLASS-METHODS',
  'PUBLIC',
  'PROTECTED',
  'PRIVATE',
  'SECTION',
  'CREATE',
  'OBJECT',
  'SELECT',
  'FROM',
  'ENDSELECT',
  'FIELD-SYMBOLS',
  'ASSIGN',
];
const types = [
  'I',
  'INT8',
  'STRING',
  'C',
  'N',
  'P',
  'F',
  'D',
  'T',
  'DECFLOAT16',
  'DECFLOAT34',
  'ABAP_BOOL',
];
monaco.languages.register({ id: 'abap', extensions: ['.abap'], aliases: ['ABAP', 'abap'] });
monaco.languages.setMonarchTokensProvider('abap', {
  ignoreCase: true,
  keywords,
  typeKeywords: types,
  tokenizer: {
    root: [
      [/^\*.*/, 'comment'],
      [/".*$/, 'comment'],
      [/'/, { token: 'string.quote', next: '@single' }],
      [/`/, { token: 'string.quote', next: '@backtick' }],
      [/\|/, { token: 'string.quote', next: '@template' }],
      [/\bsy-[a-z_]+\b/, 'variable.predefined'],
      [
        /[a-z_][\w-]*/,
        { cases: { '@keywords': 'keyword', '@typeKeywords': 'type', '@default': 'identifier' } },
      ],
      [/\d+(?:\.\d+)?/, 'number'],
      [/[()\[\]{}]/, '@brackets'],
      [/[=<>+*/&-]+/, 'operator'],
      [/[.,:]/, 'delimiter'],
      [/\s+/, 'white'],
    ],
    single: [
      [/''/, 'string.escape'],
      [/[^']+/, 'string'],
      [/'/, { token: 'string.quote', next: '@pop' }],
    ],
    backtick: [
      [/``/, 'string.escape'],
      [/[^`]+/, 'string'],
      [/`/, { token: 'string.quote', next: '@pop' }],
    ],
    template: [
      [/\\./, 'string.escape'],
      [/\{/, { token: 'delimiter.bracket', next: '@interpolation' }],
      [/\|/, { token: 'string.quote', next: '@pop' }],
      [/[^|{\\]+/, 'string'],
    ],
    interpolation: [[/\}/, { token: 'delimiter.bracket', next: '@pop' }], { include: '@root' }],
  },
});
monaco.languages.setLanguageConfiguration('abap', {
  comments: { lineComment: '"' },
  brackets: [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
    { open: '`', close: '`', notIn: ['string', 'comment'] },
    { open: '|', close: '|', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: "'", close: "'" },
    { open: '`', close: '`' },
    { open: '|', close: '|' },
  ],
  indentationRules: {
    increaseIndentPattern: /^\s*(?:IF|ELSEIF|ELSE|DO|WHILE|LOOP|CASE|WHEN|CLASS|METHOD)\b.*\.\s*$/i,
    decreaseIndentPattern:
      /^\s*(?:ENDIF|ELSEIF|ELSE|ENDDO|ENDWHILE|ENDLOOP|ENDCASE|WHEN|ENDCLASS|ENDMETHOD)\b/i,
  },
});
monaco.languages.registerCompletionItemProvider('abap', {
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    const snippets = [
      ['data', 'DATA(${1:lv_value}) = ${2:0}.', 'Inline declaration'],
      ['if', 'IF ${1:condition}.\n  ${0}\nENDIF.', 'Conditional block'],
      [
        'loop',
        'LOOP AT ${1:lt_table} INTO DATA(${2:ls_row}).\n  ${0}\nENDLOOP.',
        'Loop over an internal table',
      ],
      ['do', 'DO ${1:10} TIMES.\n  ${0}\nENDDO.', 'Counted loop'],
      ['report', 'REPORT ${1:zprogram}.\n\n${0}', 'Executable report'],
      ['write', 'WRITE / ${1:lv_value}.', 'Output a value'],
      [
        'structure',
        'TYPES:\n  BEGIN OF ${1:ty_row},\n    ${2:name} TYPE ${3:string},\n  END OF ${1:ty_row}.',
        'Structure type',
      ],
    ];
    return {
      suggestions: [
        ...snippets.map(([label, insertText, detail]) => ({
          label,
          insertText,
          detail,
          range,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: `0${label}`,
        })),
        ...keywords.map((label) => ({
          label,
          insertText: label,
          range,
          kind: monaco.languages.CompletionItemKind.Keyword,
          detail: 'ABAP keyword · see Help for supported syntax',
        })),
        ...types.map((label) => ({
          label: label.toLowerCase(),
          insertText: label.toLowerCase(),
          range,
          kind: monaco.languages.CompletionItemKind.Class,
          detail: 'ABAP primitive type',
        })),
        ...[
          'sy-subrc',
          'sy-tabix',
          'sy-index',
          'sy-datum',
          'sy-uzeit',
          'sy-uname',
          'abap_true',
          'abap_false',
        ].map((label) => ({
          label,
          insertText: label,
          range,
          kind: monaco.languages.CompletionItemKind.Variable,
          detail: 'ABAP system value',
        })),
      ],
    };
  },
});
monaco.languages.registerDocumentFormattingEditProvider('abap', {
  async provideDocumentFormattingEdits(model) {
    return [
      { range: model.getFullModelRange(), text: await window.desktop.format(model.getValue()) },
    ];
  },
});
monaco.languages.registerFoldingRangeProvider('abap', {
  provideFoldingRanges(model) {
    const stack: number[] = [],
      ranges: monaco.languages.FoldingRange[] = [];
    for (let line = 1; line <= model.getLineCount(); line++) {
      const text = model.getLineContent(line).trim();
      if (/^(?:IF|CASE|DO|WHILE|LOOP|CLASS|METHOD)\b/i.test(text)) stack.push(line);
      else if (/^(?:ENDIF|ENDCASE|ENDDO|ENDWHILE|ENDLOOP|ENDCLASS|ENDMETHOD)\b/i.test(text)) {
        const start = stack.pop();
        if (start && start < line)
          ranges.push({ start, end: line, kind: monaco.languages.FoldingRangeKind.Region });
      }
    }
    return ranges;
  },
});
monaco.editor.defineTheme('studio-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'C4A0EC' },
    { token: 'type', foreground: '87CBCD' },
    { token: 'string', foreground: 'C1D797' },
    { token: 'number', foreground: 'E5BC86' },
    { token: 'comment', foreground: '65787B', fontStyle: 'italic' },
    { token: 'variable.predefined', foreground: 'E5BC86' },
    { token: 'identifier', foreground: 'D4DFE1' },
    { token: 'operator', foreground: 'A5B9C0' },
  ],
  colors: {
    'editor.background': '#11191D',
    'editor.foreground': '#D4DFE1',
    'editorLineNumber.foreground': '#465B63',
    'editorLineNumber.activeForeground': '#B8CECF',
    'editorCursor.foreground': '#73D7BC',
    'editor.selectionBackground': '#294F50',
    'editor.inactiveSelectionBackground': '#243A40',
    'editor.lineHighlightBackground': '#172227',
    'editorIndentGuide.background1': '#213037',
    'editorIndentGuide.activeBackground1': '#3A5159',
    'editorWidget.background': '#1A262D',
    'editorWidget.border': '#34434A',
    'editorGutter.background': '#11191D',
    'editorOverviewRuler.border': '#11191D',
    'scrollbarSlider.background': '#3B4D5650',
    'scrollbarSlider.hoverBackground': '#52636A70',
    'editorSuggestWidget.background': '#1A262D',
    'editorSuggestWidget.border': '#34434A',
    'editorSuggestWidget.selectedBackground': '#29434A',
    'editorError.foreground': '#F48A8A',
    'editorWarning.foreground': '#E5BC86',
  },
});
monaco.editor.defineTheme('studio-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '8254A3' },
    { token: 'type', foreground: '217A87' },
    { token: 'string', foreground: '588322' },
    { token: 'number', foreground: 'A86822' },
    { token: 'comment', foreground: '849197', fontStyle: 'italic' },
    { token: 'variable.predefined', foreground: 'A86822' },
  ],
  colors: {
    'editor.background': '#FAFCFC',
    'editor.foreground': '#273D45',
    'editorLineNumber.foreground': '#9AAAB1',
    'editorLineNumber.activeForeground': '#45636C',
    'editor.lineHighlightBackground': '#F0F5F5',
    'editor.selectionBackground': '#CCE5DF',
    'editorCursor.foreground': '#187E68',
    'editorGutter.background': '#FAFCFC',
    'editorIndentGuide.background1': '#DFE9E9',
  },
});
export { monaco };
