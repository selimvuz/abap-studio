import {
  type Assignable,
  type Expression,
  type Program,
  type Statement,
  type Target,
  type TypeSpec,
} from '../../abap-ast/src/index';
import { tokenize } from '../../abap-lexer/src/index';
import { ExpressionParser } from './expressions';

class Parser extends ExpressionParser {
  program(): Program {
    const loc = this.current.loc;
    return { kind: 'program', statements: this.block([]), loc };
  }
  private block(until: string[]): Statement[] {
    const result: Statement[] = [];
    while (this.current.kind !== 'eof' && !until.includes(this.current.value))
      result.push(...this.statement());
    return result;
  }
  private end(name: string): void {
    this.expect(name);
    this.expect('.');
  }
  private assignmentTarget(): Assignable {
    const expr = this.expression(8);
    if (expr.kind !== 'reference' && expr.kind !== 'component' && expr.kind !== 'tableAccess')
      this.fail('Expected an assignable variable or component.', expr.loc);
    return expr;
  }
  private intoTarget(): Target {
    const loc = this.current.loc;
    if (this.accept('DATA')) {
      this.expect('(');
      const name = this.identifier().value;
      this.expect(')');
      return { name, inline: true, loc };
    }
    return { name: this.identifier().value, inline: false, loc };
  }
  private typeSpec(): TypeSpec {
    if (this.is('SORTED') || this.is('HASHED'))
      this.fail('Only STANDARD TABLE is supported in this version.');
    if (this.accept('STANDARD') || this.is('TABLE')) {
      this.expect('TABLE');
      this.expect('OF');
      const element = this.typeSpec();
      if (this.accept('WITH')) {
        if (!this.accept('EMPTY') && !this.accept('DEFAULT'))
          this.fail('Only EMPTY KEY or DEFAULT KEY is supported for standard tables.');
        this.expect('KEY');
      }
      return { kind: 'table', element };
    }
    const result: TypeSpec = { kind: 'named', name: this.identifier().value };
    if (this.accept('LENGTH')) {
      if (this.current.kind !== 'number') this.fail('LENGTH requires a numeric literal.');
      result.length = Number(this.take().value);
    }
    if (this.accept('DECIMALS')) {
      if (this.current.kind !== 'number') this.fail('DECIMALS requires a numeric literal.');
      result.decimals = Number(this.take().value);
    }
    return result;
  }
  private declarations(keyword: string): Statement[] {
    const result: Statement[] = [];
    const chained = this.accept(':');
    do {
      const loc = this.current.loc;
      if (this.accept('BEGIN')) {
        this.expect('OF');
        const name = this.identifier().value;
        this.expect(',');
        const fields: Extract<TypeSpec, { kind: 'structure' }>['fields'] = [];
        while (!this.is('END')) {
          const field = this.identifier();
          this.expect('TYPE');
          const type = this.typeSpec();
          fields.push({ name: field.value, type, loc: field.loc });
          this.expect(',');
        }
        this.expect('END');
        this.expect('OF');
        const end = this.identifier();
        if (end.value !== name) this.fail(`END OF ${end.value} does not match ${name}.`, end.loc);
        const type: TypeSpec = { kind: 'structure', fields };
        if (keyword === 'TYPES') result.push({ kind: 'type', name, type, loc });
        else if (keyword === 'DATA')
          result.push({
            kind: 'declare',
            name,
            type,
            constant: false,
            parameter: false,
            inline: false,
            loc,
          });
        else this.fail('Structures may be declared with TYPES or DATA.', loc);
      } else if (this.accept('(')) {
        if (!['DATA', 'FINAL'].includes(keyword))
          this.fail('Inline declaration requires DATA or FINAL.', loc);
        const name = this.identifier().value;
        this.expect(')');
        this.expect('=');
        const value = this.expression();
        result.push({
          kind: 'declare',
          name,
          value,
          constant: keyword === 'FINAL',
          parameter: false,
          inline: true,
          loc,
        });
      } else {
        const name = this.identifier().value;
        this.expect('TYPE');
        const type = this.typeSpec();
        if (keyword === 'TYPES') result.push({ kind: 'type', name, type, loc });
        else {
          let value: Expression | undefined;
          if (this.accept(keyword === 'PARAMETERS' ? 'DEFAULT' : 'VALUE')) {
            if (this.accept('IS')) this.expect('INITIAL');
            else value = this.expression();
          }
          if (keyword === 'CONSTANTS' && !value) this.fail('CONSTANTS requires a VALUE.', loc);
          result.push({
            kind: 'declare',
            name,
            type,
            value,
            constant: keyword === 'CONSTANTS' || keyword === 'FINAL',
            parameter: keyword === 'PARAMETERS',
            inline: false,
            loc,
          });
        }
      }
      if (!chained) break;
    } while (this.accept(','));
    this.expect('.');
    return result;
  }
  private statement(): Statement[] {
    const token = this.take(),
      loc = token.loc,
      keyword = token.value;
    if (['DATA', 'FINAL', 'TYPES', 'CONSTANTS', 'PARAMETERS'].includes(keyword))
      return this.declarations(keyword);
    let result: Statement;
    if (keyword === 'REPORT' || keyword === 'PROGRAM')
      result = { kind: 'report', name: this.identifier().value, loc };
    else if (
      keyword === 'INITIALIZATION' ||
      keyword === 'START-OF-SELECTION' ||
      keyword === 'END-OF-SELECTION'
    )
      result = { kind: 'event', name: keyword, loc };
    else if (keyword === 'WRITE') {
      const items: Extract<Statement, { kind: 'write' }>['items'] = [];
      const chain = this.accept(':');
      do {
        const newline = this.accept('/');
        items.push({ newline, value: this.expression() });
        if (!chain) break;
      } while (this.accept(','));
      result = { kind: 'write', items, loc };
    } else if (keyword === 'CLEAR' || keyword === 'FREE') {
      const targets: Assignable[] = [];
      const chain = this.accept(':');
      do {
        targets.push(this.assignmentTarget());
        if (!chain) break;
      } while (this.accept(','));
      result = { kind: 'clear', targets, loc };
    } else if (keyword === 'MOVE') {
      const value = this.expression();
      this.expect('TO');
      result = { kind: 'assign', target: this.assignmentTarget(), value, loc };
    } else if (keyword === 'IF') {
      const condition = this.expression();
      this.expect('.');
      const branches = [{ condition, body: this.block(['ELSEIF', 'ELSE', 'ENDIF']) }];
      while (this.accept('ELSEIF')) {
        const condition = this.expression();
        this.expect('.');
        branches.push({ condition, body: this.block(['ELSEIF', 'ELSE', 'ENDIF']) });
      }
      const otherwise = this.accept('ELSE') ? (this.expect('.'), this.block(['ENDIF'])) : [];
      this.end('ENDIF');
      return [{ kind: 'if', branches, otherwise, loc }];
    } else if (keyword === 'CASE') {
      const value = this.expression();
      this.expect('.');
      const branches: Extract<Statement, { kind: 'case' }>['branches'] = [];
      let otherwise: Statement[] = [];
      while (this.accept('WHEN')) {
        if (this.accept('OTHERS')) {
          this.expect('.');
          otherwise = this.block(['ENDCASE']);
          break;
        }
        const values = [this.expression(2)];
        while (this.accept('OR')) values.push(this.expression(2));
        this.expect('.');
        branches.push({ values, body: this.block(['WHEN', 'ENDCASE']) });
      }
      this.end('ENDCASE');
      return [{ kind: 'case', value, branches, otherwise, loc }];
    } else if (keyword === 'DO') {
      const times = this.is('.') ? undefined : this.expression();
      if (times) this.expect('TIMES');
      this.expect('.');
      const body = this.block(['ENDDO']);
      this.end('ENDDO');
      return [{ kind: 'do', times, body, loc }];
    } else if (keyword === 'WHILE') {
      const condition = this.expression();
      this.expect('.');
      const body = this.block(['ENDWHILE']);
      this.end('ENDWHILE');
      return [{ kind: 'while', condition, body, loc }];
    } else if (keyword === 'LOOP') {
      this.expect('AT');
      const table = this.expression();
      this.expect('INTO');
      const target = this.intoTarget();
      const where = this.accept('WHERE') ? this.expression() : undefined;
      this.expect('.');
      const body = this.block(['ENDLOOP']);
      this.end('ENDLOOP');
      return [{ kind: 'loop', table, target, body, where, loc }];
    } else if (
      keyword === 'CHECK' ||
      keyword === 'CONTINUE' ||
      keyword === 'EXIT' ||
      keyword === 'RETURN'
    )
      result = {
        kind: 'control',
        action: keyword,
        condition: keyword === 'CHECK' ? this.expression() : undefined,
        loc,
      };
    else if (keyword === 'APPEND' || keyword === 'INSERT') {
      const value = this.expression();
      this.expect(keyword === 'APPEND' ? 'TO' : 'INTO');
      // TABLE is also a legal variable name. Consume the optional keyword only
      // when another table identifier follows it, not before INDEX or a period.
      if (
        keyword === 'INSERT' &&
        this.is('TABLE') &&
        this.peek().kind === 'word' &&
        this.peek().value !== 'INDEX'
      )
        this.take();
      const table = this.assignmentTarget();
      const index = this.accept('INDEX') ? this.expression() : undefined;
      result = { kind: 'append', value, table, index, loc };
    } else if (keyword === 'READ') {
      this.expect('TABLE');
      const table = this.expression();
      let target: Target | undefined,
        index: Expression | undefined,
        keys: { name: string; value: Expression }[] | undefined;
      if (this.accept('INTO')) target = this.intoTarget();
      if (this.accept('INDEX')) index = this.expression();
      else if (this.accept('WITH')) {
        this.expect('KEY');
        keys = this.keyValues('.');
      }
      if (!target && this.accept('INTO')) target = this.intoTarget();
      if (this.accept('TRANSPORTING')) {
        this.expect('NO');
        this.expect('FIELDS');
      } else if (!target) this.fail('READ TABLE requires INTO or TRANSPORTING NO FIELDS.');
      if (!index && !keys) this.fail('READ TABLE requires INDEX or WITH KEY.');
      result = { kind: 'read', table, target, index, keys, loc };
    } else if (keyword === 'DELETE') {
      const table = this.assignmentTarget();
      this.expect('INDEX');
      result = { kind: 'delete', table, index: this.expression(), loc };
    } else if (keyword === 'MODIFY') {
      const table = this.assignmentTarget();
      this.expect('FROM');
      const value = this.expression();
      const index = this.accept('INDEX') ? this.expression() : undefined;
      result = { kind: 'modify', table, value, index, loc };
    } else if (keyword === 'SORT') {
      const table = this.assignmentTarget();
      const descending = this.accept('DESCENDING');
      this.accept('ASCENDING');
      const fields: { name: string; descending: boolean }[] = [];
      if (this.accept('BY'))
        while (!this.is('.') && this.current.kind === 'word') {
          const name = this.identifier().value,
            down = this.accept('DESCENDING');
          this.accept('ASCENDING');
          fields.push({ name, descending: down });
        }
      result = { kind: 'sort', table, fields, descending, loc };
    } else if (keyword === 'CONCATENATE') {
      const values: Expression[] = [];
      while (!this.is('INTO') && this.current.kind !== 'eof') values.push(this.expression());
      this.expect('INTO');
      const target = this.assignmentTarget();
      let separator: Expression | undefined;
      if (this.accept('SEPARATED')) {
        this.expect('BY');
        separator = this.expression();
      }
      if (values.length < 2) this.fail('CONCATENATE requires at least two values.', loc);
      result = { kind: 'concatenate', values, target, separator, loc };
    } else if (keyword === 'SPLIT') {
      const value = this.expression();
      this.expect('AT');
      const separator = this.expression();
      this.expect('INTO');
      const targets: Assignable[] = [];
      const table = this.accept('TABLE') ? this.assignmentTarget() : undefined;
      if (!table)
        while (!this.is('.') && this.current.kind !== 'eof') targets.push(this.assignmentTarget());
      if (!table && !targets.length) this.fail('SPLIT requires at least one target.', loc);
      result = { kind: 'split', value, separator, table, targets, loc };
    } else if (keyword === 'CONDENSE')
      result = {
        kind: 'condense',
        target: this.assignmentTarget(),
        noGaps: this.accept('NO-GAPS'),
        loc,
      };
    else {
      if (
        token.kind !== 'word' ||
        [
          'CLASS',
          'SELECT',
          'CALL',
          'ASSIGN',
          'FIELD-SYMBOLS',
          'CREATE',
          'METHOD',
          'NEW',
          'FORM',
          'PERFORM',
        ].includes(keyword)
      )
        this.fail(`${keyword} is not supported in this version.`, loc);
      this.position--;
      const target = this.assignmentTarget();
      if (!this.accept('='))
        this.fail(`Unsupported statement ${keyword}; expected an assignment (=).`, loc);
      result = { kind: 'assign', target, value: this.expression(), loc };
    }
    this.expect('.');
    return [result];
  }
}
export function parseProgram(source: string): Program {
  return new Parser(tokenize(source)).program();
}
