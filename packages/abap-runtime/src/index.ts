import {
  AbapError,
  type Assignable,
  type Expression,
  type Statement,
} from '../../abap-ast/src/index';
import { analyzeProgram, componentType } from '../../abap-language-service/src/analysis';
import { parseProgram } from '../../abap-parser/src/index';
import {
  cloneValue,
  compare,
  convert,
  display,
  initialValue,
  numeric,
  truth,
  type AbapType,
} from '../../abap-standard-library/src/index';
import type { DataValue, ExecutionSnapshot, Variable } from '../../shared/src/index';
import { checkedIndex, Context, fieldValue, matchesKeys } from './context';
import { Expressions } from './expressions';
export interface ExecutionOptions {
  parameters?: Record<string, string>;
  maxStatements?: number;
  timeoutMs?: number;
  onOutput?: (text: string) => void;
  onStatement?: (snapshot: ExecutionSnapshot) => Promise<void>;
}
export interface ExecutionResult {
  output: string;
  variables: Variable[];
  statements: number;
}
type Flow = 'continue' | 'exit' | 'return' | undefined;
class Interpreter {
  private readonly expressions: Expressions;
  private readonly started = Date.now();
  private output = '';
  private statements = 0;
  private loopDepth = 0;
  private readonly loops: { table: DataValue[]; index: number }[] = [];
  private readonly parameters: Record<string, string>;
  private readonly limit: number;
  private readonly timeout: number;
  constructor(
    private readonly context: Context,
    private readonly options: ExecutionOptions,
  ) {
    this.expressions = new Expressions(context);
    this.parameters = Object.fromEntries(
      Object.entries(options.parameters ?? {}).map(([key, value]) => [key.toUpperCase(), value]),
    );
    this.limit = Math.max(1, options.maxStatements ?? 100_000);
    this.timeout = Math.max(1, options.timeoutMs ?? 5_000);
  }
  private value(expr: Expression): DataValue {
    return this.expressions.evaluate(expr);
  }
  private set(target: Assignable, value: DataValue, sourceType?: AbapType): void {
    this.expressions.assign(target, value, sourceType);
  }
  private async tick(statement: Statement): Promise<void> {
    if (++this.statements > this.limit)
      throw new AbapError(
        `Execution stopped: statement limit (${this.limit.toLocaleString()}) exceeded.`,
        statement.loc,
      );
    if (Date.now() - this.started > this.timeout)
      throw new AbapError(
        `Execution stopped: timeout (${this.timeout} ms) exceeded.`,
        statement.loc,
      );
    if (this.options.onStatement)
      await this.options.onStatement({
        line: statement.loc.line,
        variables: this.context.variables(),
        statements: this.statements,
      });
    if (this.statements % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  private emit(text: string, statement: Statement): void {
    if (this.output.length + text.length > 8 * 1024 * 1024)
      throw new AbapError('Output limit (8 MiB) exceeded.', statement.loc);
    this.output += text;
    this.options.onOutput?.(text);
  }
  private rows(expr: Expression): DataValue[] {
    const rows = this.value(expr);
    if (!Array.isArray(rows)) throw new AbapError('An internal table is required.', expr.loc);
    return rows;
  }
  private tableType(
    expr: Expression,
  ): Extract<ReturnType<Context['reference']>['type'], { kind: 'table' }> {
    const type = this.context.model.expressionTypes.get(expr);
    if (!type || type.kind !== 'table')
      throw new AbapError('An internal table is required.', expr.loc);
    return type;
  }
  private async block(statements: Statement[]): Promise<Flow> {
    for (const s of statements) {
      const flow = await this.execute(s);
      if (flow) return flow;
    }
    return undefined;
  }
  private async repeat(s: Extract<Statement, { kind: 'do' | 'while' }>): Promise<Flow> {
    const count =
      s.kind === 'do' && s.times
        ? Math.max(0, Math.trunc(numeric(this.value(s.times), s.loc)))
        : Infinity;
    const previousIndex = this.context.values.get('SY-INDEX') ?? 0;
    let index = 0;
    this.loopDepth++;
    try {
      while (s.kind === 'do' ? index < count : truth(this.value(s.condition))) {
        if (index > 0) await this.tick(s);
        this.context.values.set('SY-INDEX', ++index);
        const flow = await this.block(s.body);
        if (flow === 'return') return flow;
        if (flow === 'exit') break;
      }
    } finally {
      this.loopDepth--;
      this.context.values.set('SY-INDEX', previousIndex);
    }
    return undefined;
  }
  private async loop(s: Extract<Statement, { kind: 'loop' }>): Promise<Flow> {
    const rows = this.rows(s.table),
      current = { table: rows, index: 0 };
    this.loops.push(current);
    this.loopDepth++;
    const previousTabix = this.context.values.get('SY-TABIX') ?? 0;
    let processed = false;
    try {
      for (; current.index < rows.length; current.index++) {
        if (current.index > 0) await this.tick(s);
        const row = rows[current.index]!;
        if (s.where) {
          this.context.row =
            row && typeof row === 'object' && !Array.isArray(row) ? row : { TABLE_LINE: row };
          let matches: boolean;
          try {
            matches = truth(this.value(s.where));
          } finally {
            this.context.row = undefined;
          }
          if (!matches) continue;
        }
        processed = true;
        this.context.values.set('SY-TABIX', current.index + 1);
        this.context
          .reference(s.target.name, s.target.loc)
          .set(cloneValue(row), this.tableType(s.table).element);
        const flow = await this.block(s.body);
        if (flow === 'return') return flow;
        if (flow === 'exit') break;
      }
    } finally {
      this.loopDepth--;
      this.loops.pop();
      this.context.values.set('SY-SUBRC', processed ? 0 : 4);
      if (this.loops.length) this.context.values.set('SY-TABIX', previousTabix);
    }
    return undefined;
  }
  private async execute(s: Statement): Promise<Flow> {
    await this.tick(s);
    switch (s.kind) {
      case 'report':
      case 'type':
      case 'event':
        break;
      case 'declare': {
        const cell = this.context.reference(s.name, s.loc);
        if (s.value) cell.set(this.value(s.value), this.context.model.expressionTypes.get(s.value));
        break;
      }
      case 'assign':
        this.set(s.target, this.value(s.value), this.context.model.expressionTypes.get(s.value));
        break;
      case 'write':
        for (const item of s.items) {
          const prefix = item.newline
            ? this.output && !this.output.endsWith('\n')
              ? '\n'
              : ''
            : this.output && !this.output.endsWith('\n')
              ? ' '
              : '';
          this.emit(
            prefix +
              display(this.value(item.value), this.context.model.expressionTypes.get(item.value)),
            s,
          );
        }
        break;
      case 'clear':
        for (const target of s.targets) {
          const cell = this.context.cell(target, this.expressions.evaluate);
          cell.set(initialValue(cell.type));
        }
        break;
      case 'if': {
        const branch = s.branches.find((branch) => truth(this.value(branch.condition)));
        return this.block(branch?.body ?? s.otherwise);
      }
      case 'case': {
        const value = this.value(s.value),
          branch = s.branches.find((branch) =>
            branch.values.some(
              (candidate) =>
                compare(
                  value,
                  this.value(candidate),
                  s.loc,
                  this.context.model.expressionTypes.get(s.value),
                  this.context.model.expressionTypes.get(candidate),
                ) === 0,
            ),
          );
        return this.block(branch?.body ?? s.otherwise);
      }
      case 'do':
      case 'while':
        return this.repeat(s);
      case 'loop':
        return this.loop(s);
      case 'control':
        if (s.action === 'CHECK')
          return truth(this.value(s.condition!))
            ? undefined
            : this.loopDepth
              ? 'continue'
              : 'return';
        else
          return s.action === 'RETURN'
            ? 'return'
            : s.action === 'EXIT'
              ? this.loopDepth
                ? 'exit'
                : 'return'
              : 'continue';
      case 'append': {
        const rows = this.rows(s.table),
          type = this.tableType(s.table);
        const row = convert(
          this.value(s.value),
          type.element,
          s.loc,
          this.context.model.expressionTypes.get(s.value),
        );
        if (s.index) {
          const index = checkedIndex(this.value(s.index), s.loc) - 1;
          if (index > rows.length) {
            this.context.values.set('SY-SUBRC', 4);
            break;
          }
          rows.splice(index, 0, row);
          this.context.values.set('SY-TABIX', index + 1);
        } else {
          rows.push(row);
          this.context.values.set('SY-TABIX', rows.length);
        }
        this.context.values.set('SY-SUBRC', 0);
        break;
      }
      case 'read': {
        const rows = this.rows(s.table),
          index = s.index
            ? checkedIndex(this.value(s.index), s.loc) - 1
            : rows.findIndex((row) =>
                matchesKeys(
                  row,
                  s.keys ?? [],
                  this.expressions.evaluate,
                  s.loc,
                  this.tableType(s.table).element,
                  this.context.model.expressionTypes,
                ),
              );
        const found = index >= 0 && index < rows.length;
        this.context.values.set('SY-SUBRC', found ? 0 : 4);
        this.context.values.set('SY-TABIX', found ? index + 1 : 0);
        if (found && s.target)
          this.context
            .reference(s.target.name, s.target.loc)
            .set(rows[index]!, this.tableType(s.table).element);
        break;
      }
      case 'delete': {
        const rows = this.rows(s.table),
          index = checkedIndex(this.value(s.index), s.loc) - 1;
        const found = index < rows.length;
        if (found) {
          rows.splice(index, 1);
          for (const loop of this.loops)
            if (loop.table === rows && index <= loop.index) loop.index--;
        }
        this.context.values.set('SY-SUBRC', found ? 0 : 4);
        break;
      }
      case 'modify': {
        const rows = this.rows(s.table),
          index =
            checkedIndex(
              s.index ? this.value(s.index) : (this.context.values.get('SY-TABIX') ?? 0),
              s.loc,
            ) - 1;
        if (index < rows.length)
          rows[index] = convert(
            this.value(s.value),
            this.tableType(s.table).element,
            s.loc,
            this.context.model.expressionTypes.get(s.value),
          );
        this.context.values.set('SY-SUBRC', index < rows.length ? 0 : 4);
        break;
      }
      case 'sort': {
        const rows = this.rows(s.table);
        rows.sort((left, right) => {
          if (!s.fields.length) {
            const type = this.tableType(s.table).element;
            if (type.kind === 'structure') {
              for (const key of Object.keys(type.fields).filter(
                (key) =>
                  type.fields[key]!.kind === 'primitive' &&
                  !['I', 'INT8', 'P', 'F', 'DECFLOAT16', 'DECFLOAT34'].includes(
                    type.fields[key]!.name,
                  ),
              )) {
                const comparison = compare(
                  fieldValue(left, key, s.loc),
                  fieldValue(right, key, s.loc),
                  s.loc,
                );
                if (comparison) return comparison * (s.descending ? -1 : 1);
              }
              return 0;
            }
            return compare(left, right, s.loc, type, type) * (s.descending ? -1 : 1);
          }
          for (const field of s.fields) {
            const type = componentType(this.tableType(s.table).element, field.name, s.loc);
            const result = compare(
              fieldValue(left, field.name, s.loc),
              fieldValue(right, field.name, s.loc),
              s.loc,
              type,
              type,
            );
            if (result) return result * (field.descending ? -1 : 1);
          }
          return 0;
        });
        break;
      }
      case 'concatenate': {
        const separator = s.separator ? String(this.value(s.separator)) : '';
        this.set(
          s.target,
          s.values
            .map((value) =>
              display(this.value(value), this.context.model.expressionTypes.get(value)),
            )
            .join(separator),
        );
        break;
      }
      case 'split': {
        const separator = String(this.value(s.separator));
        if (!separator) throw new AbapError('SPLIT separator cannot be empty.', s.loc);
        const parts = String(this.value(s.value)).split(separator);
        if (s.table) this.set(s.table, parts);
        else
          s.targets.forEach((target, index) =>
            this.set(
              target,
              index === s.targets.length - 1
                ? parts.slice(index).join(separator)
                : (parts[index] ?? ''),
            ),
          );
        this.context.values.set('SY-SUBRC', 0);
        break;
      }
      case 'condense': {
        const value = String(this.value(s.target));
        this.set(s.target, s.noGaps ? value.replace(/ /g, '') : value.trim().replace(/ +/g, ' '));
        break;
      }
    }
    return undefined;
  }
  async run(): Promise<ExecutionResult> {
    const sections: Record<string, Statement[]> = {
      PRELUDE: [],
      INITIALIZATION: [],
      'START-OF-SELECTION': [],
      'END-OF-SELECTION': [],
    };
    let current = 'PRELUDE';
    for (const statement of this.context.model.program.statements) {
      if (statement.kind === 'event') current = statement.name;
      else sections[current]!.push(statement);
    }
    // Unlabelled executable statements belong to the implicit start event.
    const prelude = sections.PRELUDE!;
    const declarative = (s: Statement): boolean =>
      s.kind === 'report' || s.kind === 'type' || (s.kind === 'declare' && !s.inline);
    await this.block(prelude.filter(declarative));
    if ((await this.block(sections.INITIALIZATION!)) !== 'return') {
      // Selection values are entered after INITIALIZATION in an ABAP report.
      for (const parameter of this.context.model.parameters)
        if (this.parameters[parameter.name] !== undefined)
          this.context
            .reference(parameter.name, this.context.model.symbols.get(parameter.name)!.loc)
            .set(this.parameters[parameter.name]!);
      const start = [...prelude.filter((s) => !declarative(s)), ...sections['START-OF-SELECTION']!];
      if ((await this.block(start)) !== 'return') await this.block(sections['END-OF-SELECTION']!);
    }
    return {
      output: this.output,
      variables: this.context.variables(),
      statements: this.statements,
    };
  }
}
export async function executeProgram(
  source: string,
  options: ExecutionOptions = {},
): Promise<ExecutionResult> {
  const model = analyzeProgram(parseProgram(source));
  const error = model.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error)
    throw new AbapError(error.message, { line: error.line, column: error.column, offset: 0 });
  return new Interpreter(new Context(model), options).run();
}
