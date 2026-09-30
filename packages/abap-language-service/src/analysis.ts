import {
  AbapError,
  type Assignable,
  type Expression,
  type Location,
  type Program,
  type Statement,
  type Target,
} from '../../abap-ast/src/index';
import {
  booleanType,
  builtinFunctions,
  convert,
  display,
  initialValue,
  integerType,
  stringType,
  TypeRegistry,
  type AbapType,
} from '../../abap-standard-library/src/index';
import type { Diagnostic, Parameter } from '../../shared/src/index';
export interface SymbolInfo {
  name: string;
  type: AbapType;
  constant: boolean;
  loc: Location;
  parameter?: boolean;
}
export interface SemanticModel {
  program: Program;
  registry: TypeRegistry;
  symbols: Map<string, SymbolInfo>;
  expressionTypes: Map<Expression, AbapType>;
  diagnostics: Diagnostic[];
  parameters: Parameter[];
}
const builtinLoc: Location = { line: 1, column: 1, offset: 0 };
export function initialSymbols(): Map<string, SymbolInfo> {
  const entries: [string, AbapType, boolean][] = [
    ['SY-SUBRC', integerType, false],
    ['SY-TABIX', integerType, false],
    ['SY-INDEX', integerType, false],
    ['SY-DATUM', { kind: 'primitive', name: 'D' }, false],
    ['SY-UZEIT', { kind: 'primitive', name: 'T' }, false],
    ['SY-UNAME', { kind: 'primitive', name: 'C', length: 12 }, false],
    ['ABAP_TRUE', booleanType, true],
    ['ABAP_FALSE', booleanType, true],
    ['SPACE', { kind: 'primitive', name: 'C', length: 1 }, true],
  ];
  return new Map(
    entries.map(([name, type, constant]) => [name, { name, type, constant, loc: builtinLoc }]),
  );
}
export function componentType(type: AbapType, name: string, loc: Location): AbapType {
  let current = type;
  for (const component of name.split('-')) {
    if (current.kind !== 'structure')
      throw new AbapError(`${current.name} has no structure components.`, loc);
    const field = current.fields[component];
    if (!field) throw new AbapError(`Unknown structure component ${component}.`, loc);
    current = field;
  }
  return current;
}
export function referenceType(
  name: string,
  symbols: Map<string, SymbolInfo>,
  loc: Location,
): AbapType {
  const exact = symbols.get(name);
  if (exact) return exact.type;
  const [base, ...path] = name.split('-');
  const symbol = symbols.get(base ?? '');
  if (!symbol) throw new AbapError(`Unknown variable ${base ?? name}.`, loc);
  return path.length ? componentType(symbol.type, path.join('-'), loc) : symbol.type;
}
class Analyzer {
  readonly registry = new TypeRegistry();
  readonly symbols = initialSymbols();
  readonly expressionTypes = new Map<Expression, AbapType>();
  readonly diagnostics: Diagnostic[] = [];
  readonly parameters: Parameter[] = [];
  private rowType?: AbapType;
  private loopDepth = 0;
  private tableLoopDepth = 0;
  constructor(readonly program: Program) {}
  error(error: unknown): void {
    if (error instanceof AbapError)
      this.diagnostics.push({
        severity: 'error',
        message: error.message,
        line: error.line,
        column: error.column,
      });
    else throw error;
  }
  private compatible(from: AbapType, to: AbapType, loc: Location): void {
    if (from.kind !== to.kind)
      throw new AbapError(`Cannot assign ${from.name} to ${to.name}.`, loc);
    if (from.kind === 'table' && to.kind === 'table')
      this.compatible(from.element, to.element, loc);
    if (from.kind === 'structure' && to.kind === 'structure') {
      const a = Object.keys(from.fields),
        b = Object.keys(to.fields);
      if (a.length !== b.length || a.some((name) => !to.fields[name]))
        throw new AbapError(`Structure ${from.name} does not match ${to.name}.`, loc);
      for (const name of a) this.compatible(from.fields[name]!, to.fields[name]!, loc);
    }
  }
  private checkValue(expression: Expression, expected: AbapType): void {
    const from = this.infer(expression, expected);
    this.compatible(from, expected, expression.loc);
    if (expression.kind === 'literal') convert(expression.value, expected, expression.loc);
  }
  infer(expr: Expression, expected?: AbapType): AbapType {
    let type: AbapType;
    switch (expr.kind) {
      case 'literal':
        type =
          typeof expr.value === 'number'
            ? Number.isInteger(expr.value) && expr.value <= 2147483647 && expr.value >= -2147483648
              ? integerType
              : { kind: 'primitive', name: 'F' }
            : typeof expr.value === 'boolean'
              ? booleanType
              : expr.literalType === 'c'
                ? { kind: 'primitive', name: 'C', length: Math.max(1, expr.value.length) }
                : stringType;
        break;
      case 'reference':
        type =
          this.rowType?.kind === 'structure' && this.rowType.fields[expr.name]
            ? this.rowType.fields[expr.name]!
            : referenceType(expr.name, this.symbols, expr.loc);
        break;
      case 'component':
        type = componentType(this.infer(expr.target), expr.name, expr.loc);
        break;
      case 'tableAccess': {
        const table = this.infer(expr.target);
        if (table.kind !== 'table')
          throw new AbapError('Table expression requires an internal table.', expr.loc);
        if (expr.index) this.scalar(expr.index);
        if (expr.keys) this.checkKeys(expr.keys, table.element);
        type = table.element;
        break;
      }
      case 'template':
        for (const part of expr.parts) if (typeof part !== 'string') this.scalar(part);
        type = stringType;
        break;
      case 'unary':
        this.scalar(expr.operand);
        type = expr.operator === 'NOT' ? booleanType : this.infer(expr.operand);
        break;
      case 'initial':
        this.infer(expr.operand);
        type = booleanType;
        break;
      case 'binary': {
        this.scalar(expr.left);
        this.scalar(expr.right);
        type =
          expr.operator === '&&'
            ? stringType
            : ['+', '-', '*', '/', 'DIV', 'MOD'].includes(expr.operator)
              ? {
                  kind: 'primitive',
                  name: expr.operator === 'DIV' || expr.operator === 'MOD' ? 'I' : 'F',
                }
              : booleanType;
        break;
      }
      case 'call': {
        const fn = builtinFunctions[expr.name];
        if (!fn) throw new AbapError(`Unknown or unsupported function ${expr.name}.`, expr.loc);
        if (expr.args.length !== 1)
          throw new AbapError(`${expr.name} requires exactly one argument.`, expr.loc);
        const argumentType = this.infer(expr.args[0]!);
        if (
          expr.name === 'LINES' ? argumentType.kind !== 'table' : argumentType.kind !== 'primitive'
        )
          throw new AbapError(
            `${expr.name} requires ${expr.name === 'LINES' ? 'an internal table' : 'a scalar argument'}.`,
            expr.loc,
          );
        type = fn.result;
        break;
      }
      case 'convert': {
        type =
          expr.typeName === '#'
            ? this.expected(expected, expr.loc)
            : this.registry.resolve({ kind: 'named', name: expr.typeName }, expr.loc);
        this.checkValue(expr.value, type);
        break;
      }
      case 'value': {
        type =
          expr.typeName === '#'
            ? this.expected(expected, expr.loc)
            : this.registry.resolve({ kind: 'named', name: expr.typeName }, expr.loc);
        if (type.kind === 'table') {
          if (expr.fields.length)
            throw new AbapError('Table VALUE requires rows enclosed in parentheses.', expr.loc);
          for (const row of expr.rows) this.checkValue(row, type.element);
        } else if (type.kind === 'structure') {
          if (expr.rows.length)
            throw new AbapError('Structure VALUE requires component assignments.', expr.loc);
          const seen = new Set<string>();
          for (const field of expr.fields) {
            if (seen.has(field.name))
              throw new AbapError(`Duplicate component ${field.name} in VALUE.`, field.value.loc);
            seen.add(field.name);
            this.checkValue(field.value, componentType(type, field.name, field.value.loc));
          }
        } else if (expr.fields.length || expr.rows.length)
          throw new AbapError('Scalar VALUE does not accept components or rows.', expr.loc);
        break;
      }
    }
    this.expressionTypes.set(expr, type);
    return type;
  }
  private expected(type: AbapType | undefined, loc: Location): AbapType {
    if (!type)
      throw new AbapError('The type of # cannot be inferred here. Use an explicit type name.', loc);
    return type;
  }
  private scalar(expr: Expression): AbapType {
    const type = this.infer(expr);
    if (type.kind !== 'primitive')
      throw new AbapError('This expression requires a scalar value.', expr.loc);
    return type;
  }
  private checkKeys(keys: { name: string; value: Expression }[], row: AbapType): void {
    for (const key of keys)
      this.checkValue(
        key.value,
        key.name === 'TABLE_LINE' ? row : componentType(row, key.name, key.value.loc),
      );
  }
  private mutable(target: Assignable): AbapType {
    let base: Expression = target;
    while (base.kind === 'component' || base.kind === 'tableAccess') base = base.target;
    if (base.kind !== 'reference')
      throw new AbapError('An assignment target must belong to a declared variable.', target.loc);
    if (base.kind === 'reference') {
      const symbol = this.symbols.get(base.name) ?? this.symbols.get(base.name.split('-')[0] ?? '');
      if (symbol?.constant)
        throw new AbapError(`Cannot change constant ${symbol.name}.`, target.loc);
    }
    return this.infer(target);
  }
  private table(expr: Expression, mutable = false): Extract<AbapType, { kind: 'table' }> {
    const type = mutable ? this.mutable(expr as Assignable) : this.infer(expr);
    if (type.kind !== 'table') throw new AbapError('An internal table is required.', expr.loc);
    return type;
  }
  private declare(
    name: string,
    type: AbapType,
    loc: Location,
    constant = false,
    parameter = false,
  ): void {
    if (this.symbols.has(name)) throw new AbapError(`Variable ${name} is already declared.`, loc);
    if (name.includes('-'))
      throw new AbapError('Variable names cannot contain a component selector (-).', loc);
    this.symbols.set(name, { name, type, loc, constant, parameter });
  }
  private target(target: Target, type: AbapType): void {
    if (target.inline) this.declare(target.name, type, target.loc);
    else
      this.compatible(
        type,
        this.mutable({ kind: 'reference', name: target.name, loc: target.loc }),
        target.loc,
      );
  }
  block(statements: Statement[]): void {
    for (const statement of statements)
      try {
        this.statement(statement);
      } catch (error) {
        this.error(error);
      }
  }
  private loop(body: Statement[]): void {
    this.loopDepth++;
    this.block(body);
    this.loopDepth--;
  }
  private statement(s: Statement): void {
    switch (s.kind) {
      case 'report':
      case 'event':
        break;
      case 'type':
        this.registry.register(s.name, s.type, s.loc);
        break;
      case 'declare': {
        const type = s.type
          ? this.registry.resolve(s.type, s.loc)
          : s.value
            ? this.infer(s.value)
            : stringType;
        if (s.value) this.checkValue(s.value, type);
        this.declare(s.name, type, s.loc, s.constant, s.parameter);
        if (s.parameter) {
          if (type.kind !== 'primitive')
            throw new AbapError('PARAMETERS supports primitive types only.', s.loc);
          let defaultValue = display(initialValue(type));
          if (s.value) {
            if (s.value.kind === 'literal')
              defaultValue = display(convert(s.value.value, type, s.loc));
            else if (
              s.value.kind === 'unary' &&
              s.value.operand.kind === 'literal' &&
              typeof s.value.operand.value === 'number' &&
              s.value.operator === '-'
            )
              defaultValue = display(convert(-s.value.operand.value, type, s.loc));
            else if (
              s.value.kind === 'reference' &&
              ['SPACE', 'ABAP_TRUE', 'ABAP_FALSE'].includes(s.value.name)
            )
              defaultValue = s.value.name === 'ABAP_TRUE' ? 'X' : '';
            else
              throw new AbapError(
                'Parameter defaults must be literals or ABAP_TRUE, ABAP_FALSE, SPACE.',
                s.value.loc,
              );
          }
          this.parameters.push({ name: s.name, type: type.name.toLowerCase(), defaultValue });
        }
        break;
      }
      case 'assign':
        this.checkValue(s.value, this.mutable(s.target));
        break;
      case 'write':
        for (const item of s.items) this.scalar(item.value);
        break;
      case 'clear':
        for (const target of s.targets) this.mutable(target);
        break;
      case 'if':
        for (const branch of s.branches) {
          this.scalar(branch.condition);
          this.block(branch.body);
        }
        this.block(s.otherwise);
        break;
      case 'case':
        this.scalar(s.value);
        for (const branch of s.branches) {
          branch.values.forEach((value) => this.scalar(value));
          this.block(branch.body);
        }
        this.block(s.otherwise);
        break;
      case 'do':
        if (s.times) this.scalar(s.times);
        this.loop(s.body);
        break;
      case 'while':
        this.scalar(s.condition);
        this.loop(s.body);
        break;
      case 'loop': {
        const table = this.table(s.table);
        this.target(s.target, table.element);
        if (s.where) {
          this.rowType =
            table.element.kind === 'structure'
              ? table.element
              : { kind: 'structure', name: 'ROW', fields: { TABLE_LINE: table.element } };
          try {
            this.scalar(s.where);
          } finally {
            this.rowType = undefined;
          }
        }
        this.tableLoopDepth++;
        try {
          this.loop(s.body);
        } finally {
          this.tableLoopDepth--;
        }
        break;
      }
      case 'control':
        if (s.condition) this.scalar(s.condition);
        if (s.action === 'CONTINUE' && !this.loopDepth)
          throw new AbapError('CONTINUE is only valid inside a loop.', s.loc);
        break;
      case 'append': {
        const type = this.table(s.table, true);
        this.checkValue(s.value, type.element);
        if (s.index) this.scalar(s.index);
        break;
      }
      case 'read': {
        const type = this.table(s.table);
        if (s.target) this.target(s.target, type.element);
        if (s.index) this.scalar(s.index);
        if (s.keys) this.checkKeys(s.keys, type.element);
        break;
      }
      case 'delete':
        this.table(s.table, true);
        this.scalar(s.index);
        break;
      case 'modify': {
        const type = this.table(s.table, true);
        this.checkValue(s.value, type.element);
        if (s.index) this.scalar(s.index);
        else if (!this.tableLoopDepth)
          throw new AbapError('MODIFY requires INDEX outside LOOP AT.', s.loc);
        break;
      }
      case 'sort': {
        const type = this.table(s.table, true);
        for (const field of s.fields) componentType(type.element, field.name, s.loc);
        break;
      }
      case 'concatenate':
        s.values.forEach((value) => this.scalar(value));
        this.mutable(s.target);
        if (s.separator) this.scalar(s.separator);
        break;
      case 'split':
        this.scalar(s.value);
        this.scalar(s.separator);
        s.targets.forEach((target) => this.mutable(target));
        if (s.table) {
          const type = this.table(s.table, true);
          if (type.element.kind !== 'primitive' || !['STRING', 'C'].includes(type.element.name))
            throw new AbapError('SPLIT requires a table of string or c.', s.loc);
        }
        break;
      case 'condense': {
        const type = this.mutable(s.target);
        if (type.kind !== 'primitive' || !['STRING', 'C'].includes(type.name))
          throw new AbapError('CONDENSE requires a character variable.', s.loc);
        break;
      }
    }
  }
  result(): SemanticModel {
    this.block(this.program.statements);
    return {
      program: this.program,
      registry: this.registry,
      symbols: this.symbols,
      expressionTypes: this.expressionTypes,
      diagnostics: this.diagnostics,
      parameters: this.parameters,
    };
  }
}
export function analyzeProgram(program: Program): SemanticModel {
  return new Analyzer(program).result();
}
