import { AbapError } from '../../abap-ast/src/index';
import { parseProgram } from '../../abap-parser/src/index';
import { tokenize } from '../../abap-lexer/src/index';
import type { CheckResult } from '../../shared/src/index';
import { analyzeProgram } from './analysis';
export { analyzeProgram } from './analysis';
export function checkProgram(source: string): CheckResult {
  try {
    const model = analyzeProgram(parseProgram(source));
    return { diagnostics: model.diagnostics, parameters: model.parameters };
  } catch (error) {
    if (error instanceof AbapError)
      return {
        diagnostics: [
          { severity: 'error', message: error.message, line: error.line, column: error.column },
        ],
        parameters: [],
      };
    throw error;
  }
}
/** Preserve literals and comments exactly; indent block and structure lines. */
export function formatProgram(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let depth = 0,
    structure = false;
  const literalLines = new Set<number>();
  try {
    for (const token of tokenize(source))
      if ((token.kind === 'template' || token.kind === 'string') && token.text.includes('\n'))
        for (
          let line = token.loc.line;
          line < token.loc.line + token.text.split('\n').length;
          line++
        )
          literalLines.add(line);
  } catch {
    return source;
  } // An unfinished literal must never be rewritten.
  return lines
    .map((line, index) => {
      if (literalLines.has(index + 1)) return line;
      const text = line.trim();
      if (!text) return '';
      if (text.startsWith('*')) return text;
      const word = (text.match(/^[A-Za-z-]+/)?.[0] ?? '').toUpperCase();
      const closing = [
        'ENDIF',
        'ENDCASE',
        'ENDDO',
        'ENDWHILE',
        'ENDLOOP',
        'ELSE',
        'ELSEIF',
        'WHEN',
      ].includes(word);
      if (closing) depth = Math.max(0, depth - (word === 'ENDCASE' ? 2 : 1));
      if (/^END\s+OF\b/i.test(text)) {
        depth = Math.max(0, depth - 1);
        structure = false;
      }
      const formatted = '  '.repeat(depth) + text;
      if (['IF', 'DO', 'WHILE', 'LOOP', 'ELSE', 'ELSEIF', 'WHEN'].includes(word)) depth++;
      if (word === 'CASE') depth += 2;
      if (/^BEGIN\s+OF\b/i.test(text) || /^(TYPES|DATA)\s*:\s*BEGIN\s+OF\b/i.test(text)) {
        depth++;
        structure = true;
      }
      if (structure && text.endsWith('.')) structure = false;
      return formatted;
    })
    .join('\n');
}
