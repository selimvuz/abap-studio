import { AbapError, type Location } from '../../abap-ast/src/index';
export interface Token {
  kind: 'word' | 'number' | 'string' | 'template' | 'symbol' | 'eof';
  text: string;
  value: string;
  loc: Location;
  end: number;
}
/** A character scanner. Comments and strings are handled before operators. */
export function tokenize(
  source: string,
  origin: Location = { line: 1, column: 1, offset: 0 },
): Token[] {
  const tokens: Token[] = [];
  let i = 0,
    line = origin.line,
    column = origin.column;
  const next = (): string => {
    const c = source[i++] ?? '';
    if (c === '\n') {
      line++;
      column = 1;
    } else column++;
    return c;
  };
  const loc = (): Location => ({ line, column, offset: origin.offset + i });
  const add = (kind: Token['kind'], start: number, at: Location, value: string): void => {
    tokens.push({ kind, text: source.slice(start, i), value, loc: at, end: origin.offset + i });
  };
  while (i < source.length) {
    const c = source[i] ?? '';
    if (/\s/.test(c)) {
      next();
      continue;
    }
    if (c === '"' || (c === '*' && column === 1)) {
      while (i < source.length && source[i] !== '\n') next();
      continue;
    }
    const start = i,
      at = loc();
    if (c === "'" || c === '`') {
      const quote = next();
      let value = '',
        closed = false;
      while (i < source.length) {
        const ch = next();
        if (ch === quote) {
          if (source[i] === quote) {
            next();
            value += quote;
          } else {
            closed = true;
            break;
          }
        } else if (ch === '\n' || ch === '\r')
          throw new AbapError('String literal must end on the same line.', at);
        else value += ch;
      }
      if (!closed) throw new AbapError('Unterminated string literal.', at);
      add('string', start, at, value);
      continue;
    }
    if (c === '|') {
      next();
      let depth = 0,
        quote = '',
        escaped = false,
        closed = false;
      while (i < source.length) {
        const ch = next();
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (quote) {
          if (ch === quote) {
            if (source[i] === quote) next();
            else quote = '';
          }
          continue;
        }
        if (depth && (ch === "'" || ch === '`')) {
          quote = ch;
          continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth < 0) throw new AbapError('Unexpected } in string template.', at);
        } else if (ch === '|' && depth === 0) {
          closed = true;
          break;
        }
      }
      if (!closed) throw new AbapError('Unterminated string template.', at);
      add('template', start, at, source.slice(start + 1, i - 1));
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      next();
      while (i < source.length) {
        const ch = source[i] ?? '';
        if (/[A-Za-z0-9_]/.test(ch)) {
          next();
          continue;
        }
        if (ch === '-' && /[A-Za-z_]/.test(source[i + 1] ?? '')) {
          next();
          continue;
        }
        break;
      }
      add('word', start, at, source.slice(start, i).toUpperCase());
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (/[0-9]/.test(source[i] ?? '')) next();
      if (source[i] === '.' && /[0-9]/.test(source[i + 1] ?? '')) {
        next();
        while (/[0-9]/.test(source[i] ?? '')) next();
      }
      add('number', start, at, source.slice(start, i));
      continue;
    }
    const pair = source.slice(i, i + 2);
    if (['<>', '>=', '<=', '&&', '->', '=>'].includes(pair)) {
      next();
      next();
      add('symbol', start, at, pair);
      continue;
    }
    if ('.:,()[]#+-*/=<>'.includes(c)) {
      next();
      add('symbol', start, at, c);
      continue;
    }
    throw new AbapError(`Unexpected character ${JSON.stringify(c)}.`, at);
  }
  tokens.push({ kind: 'eof', text: '', value: '<EOF>', loc: loc(), end: origin.offset + i });
  return tokens;
}
