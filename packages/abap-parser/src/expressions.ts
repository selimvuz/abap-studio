import { AbapError, type Expression, type Location } from '../../abap-ast/src/index';
import { tokenize, type Token } from '../../abap-lexer/src/index';
const precedence: Record<string, number> = {
  OR: 1,
  AND: 2,
  '=': 3,
  '<>': 3,
  '>': 3,
  '<': 3,
  '>=': 3,
  '<=': 3,
  EQ: 3,
  NE: 3,
  GT: 3,
  LT: 3,
  GE: 3,
  LE: 3,
  '&&': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  DIV: 6,
  MOD: 6,
};
export class ExpressionParser {
  protected position = 0;
  constructor(protected readonly tokens: Token[]) {}
  protected get current(): Token {
    return this.tokens[this.position] ?? this.tokens[this.tokens.length - 1]!;
  }
  protected peek(n = 1): Token {
    return this.tokens[this.position + n] ?? this.tokens[this.tokens.length - 1]!;
  }
  protected is(value: string): boolean {
    return this.current.value === value;
  }
  protected take(): Token {
    return this.tokens[this.position++] ?? this.tokens[this.tokens.length - 1]!;
  }
  protected accept(value: string): boolean {
    if (!this.is(value)) return false;
    this.take();
    return true;
  }
  protected expect(value: string): Token {
    if (!this.is(value))
      this.fail(`Expected ${value}, found ${this.current.text || 'end of program'}.`);
    return this.take();
  }
  protected fail(message: string, loc: Location = this.current.loc): never {
    throw new AbapError(message, loc);
  }
  protected identifier(): Token {
    if (this.current.kind !== 'word') this.fail('Expected an identifier.');
    return this.take();
  }
  public expression(min = 0): Expression {
    let left = this.primary();
    while (true) {
      if (this.is('IS') && min <= 3) {
        this.take();
        const negate = this.accept('NOT');
        this.expect('INITIAL');
        left = { kind: 'initial', loc: left.loc, operand: left, negate };
        continue;
      }
      const level = precedence[this.current.value];
      if (level === undefined || level < min) break;
      const operator = this.take().value,
        right = this.expression(level + 1);
      left = { kind: 'binary', operator, left, right, loc: left.loc };
    }
    return left;
  }
  private primary(): Expression {
    const token = this.take();
    const loc = token.loc;
    let result: Expression;
    if (token.kind === 'number') result = { kind: 'literal', value: Number(token.value), loc };
    else if (token.kind === 'string')
      result = {
        kind: 'literal',
        value: token.value,
        literalType: token.text[0] === '`' ? 'string' : 'c',
        loc,
      };
    else if (token.kind === 'template') result = this.template(token);
    else if (['+', '-', 'NOT'].includes(token.value))
      result = {
        kind: 'unary',
        operator: token.value,
        operand: this.expression(token.value === 'NOT' ? 3 : 7),
        loc,
      };
    else if (token.value === '(') {
      result = this.expression();
      this.expect(')');
    } else if (token.value === 'VALUE') {
      const typeName = this.accept('#') ? '#' : this.identifier().value;
      this.expect('(');
      result = this.valueBody(typeName, loc);
      this.expect(')');
    } else if (token.value === 'CONV') {
      const typeName = this.accept('#') ? '#' : this.identifier().value;
      this.expect('(');
      const value = this.expression();
      this.expect(')');
      result = { kind: 'convert', typeName, value, loc };
    } else if (token.kind === 'word') {
      if (this.accept('(')) {
        const args: Expression[] = [];
        while (!this.is(')')) {
          args.push(this.expression());
          if (!this.accept(',') && !this.is(')'))
            this.fail('Expected ) or comma between function arguments.');
        }
        this.expect(')');
        result = { kind: 'call', name: token.value, args, loc };
      } else result = { kind: 'reference', name: token.value, loc };
    } else this.fail(`Expected an expression, found ${token.text || 'end of program'}.`, loc);
    while (true) {
      if (this.accept('[')) {
        if (this.current.kind === 'word' && this.peek().value === '=') {
          const keys = this.keyValues(']');
          this.expect(']');
          result = { kind: 'tableAccess', target: result, keys, loc };
        } else {
          const index = this.expression();
          this.expect(']');
          result = { kind: 'tableAccess', target: result, index, loc };
        }
      } else if (this.is('-') && this.current.loc.offset === this.tokens[this.position - 1]?.end) {
        this.take();
        result = { kind: 'component', target: result, name: this.identifier().value, loc };
      } else break;
    }
    return result;
  }
  protected keyValues(end: string): { name: string; value: Expression }[] {
    const fields: { name: string; value: Expression }[] = [];
    while (!this.is(end) && this.current.kind === 'word' && this.peek().value === '=') {
      const name = this.take().value;
      this.expect('=');
      fields.push({ name, value: this.expression(4) });
    }
    if (!fields.length) this.fail('Expected at least one component = value.');
    return fields;
  }
  private valueBody(typeName: string, loc: Location): Expression {
    const fields: { name: string; value: Expression }[] = [],
      rows: Expression[] = [];
    while (!this.is(')')) {
      if (this.accept('(')) {
        if (this.current.kind === 'word' && this.peek().value === '=')
          rows.push(this.valueBody('#', this.current.loc));
        else rows.push(this.expression());
        this.expect(')');
      } else if (this.current.kind === 'word' && this.peek().value === '=') {
        const name = this.take().value;
        this.expect('=');
        fields.push({ name, value: this.expression(4) });
      } else {
        if (fields.length || rows.length) this.fail('Expected a structure component or table row.');
        const value = this.expression();
        this.expect(')');
        this.position--;
        return { kind: 'convert', typeName, value, loc };
      }
    }
    return { kind: 'value', typeName, fields, rows, loc };
  }
  private template(token: Token): Expression {
    const raw = token.value,
      parts: (string | Expression)[] = [];
    let text = '',
      i = 0;
    const at = (index: number): Location => {
      const before = raw.slice(0, index),
        lines = before.split('\n');
      return {
        line: token.loc.line + lines.length - 1,
        column:
          lines.length === 1
            ? token.loc.column + 1 + index
            : (lines[lines.length - 1]?.length ?? 0) + 1,
        offset: token.loc.offset + index + 1,
      };
    };
    while (i < raw.length) {
      const c = raw[i++]!;
      if (c === '\\') {
        const escaped = raw[i++];
        const escapes: Record<string, string> = {
          n: '\n',
          r: '\r',
          t: '\t',
          '|': '|',
          '{': '{',
          '}': '}',
          '\\': '\\',
        };
        if (!escaped || escapes[escaped] === undefined)
          this.fail('Unsupported template escape.', at(i - 2));
        text += escapes[escaped];
      } else if (c === '{') {
        if (text) {
          parts.push(text);
          text = '';
        }
        const start = i;
        let quote = '',
          depth = 1;
        while (i < raw.length && depth) {
          const ch = raw[i++]!;
          if (quote) {
            if (ch === quote) {
              if (raw[i] === quote) i++;
              else quote = '';
            }
          } else if (ch === "'" || ch === '`') quote = ch;
          else if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        if (depth) this.fail('Missing } in string template.', at(start));
        const parser = new ExpressionParser(tokenize(raw.slice(start, i - 1), at(start)));
        const value = parser.expression();
        if (parser.current.kind !== 'eof')
          this.fail('Template formatting options are not supported yet.', parser.current.loc);
        parts.push(value);
      } else text += c;
    }
    if (text) parts.push(text);
    return { kind: 'template', parts, loc: token.loc };
  }
}
