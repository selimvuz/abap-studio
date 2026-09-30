import {
  AbapError,
  type Assignable,
  type Expression,
  type Location,
} from '../../abap-ast/src/index';
import type { SemanticModel } from '../../abap-language-service/src/analysis';
import {
  cloneValue,
  compare,
  convert,
  initialValue,
  type AbapType,
} from '../../abap-standard-library/src/index';
import type { DataValue, Variable } from '../../shared/src/index';
export interface Cell {
  type: AbapType;
  get(): DataValue;
  set(value: DataValue, sourceType?: AbapType): void;
}
export class Context {
  readonly values = new Map<string, DataValue>();
  row?: Record<string, DataValue>;
  constructor(readonly model: SemanticModel) {
    for (const [name, symbol] of model.symbols) this.values.set(name, initialValue(symbol.type));
    this.values.set('ABAP_TRUE', 'X');
    const now = new Date(),
      pad = (n: number): string => String(n).padStart(2, '0');
    this.values.set(
      'SY-DATUM',
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    );
    this.values.set(
      'SY-UZEIT',
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    );
    this.values.set('SY-UNAME', 'LOCAL'.padEnd(12));
  }
  variables(): Variable[] {
    return Array.from(this.model.symbols)
      .filter(([name]) => !['ABAP_TRUE', 'ABAP_FALSE', 'SPACE'].includes(name))
      .map(([name, symbol]) => ({
        name,
        type: symbol.type.name.toLowerCase(),
        value: cloneValue(this.values.get(name) ?? initialValue(symbol.type)),
      }));
  }
  reference(name: string, loc: Location): Cell {
    const exact = this.model.symbols.get(name);
    if (exact)
      return {
        type: exact.type,
        get: () => this.values.get(name) ?? initialValue(exact.type),
        set: (value, sourceType) =>
          this.values.set(name, convert(value, exact.type, loc, sourceType)),
      };
    const [base, ...components] = name.split('-');
    if (!base || !this.model.symbols.has(base))
      throw new AbapError(`Unknown variable ${name}.`, loc);
    return this.component(this.reference(base, loc), components.join('-'), loc);
  }
  component(cell: Cell, name: string, loc: Location): Cell {
    let current = cell;
    for (const part of name.split('-')) {
      const type = current.type;
      if (type.kind !== 'structure' || !type.fields[part])
        throw new AbapError(`Unknown structure component ${part}.`, loc);
      const parent = current,
        fieldType = type.fields[part]!;
      current = {
        type: fieldType,
        get: () => (parent.get() as Record<string, DataValue>)[part] ?? initialValue(fieldType),
        set: (value, sourceType) => {
          (parent.get() as Record<string, DataValue>)[part] = convert(
            value,
            fieldType,
            loc,
            sourceType,
          );
        },
      };
    }
    return current;
  }
  cell(target: Assignable, evaluate: (expression: Expression) => DataValue): Cell {
    if (target.kind === 'reference') return this.reference(target.name, target.loc);
    if (target.kind === 'component')
      return this.component(
        this.cell(target.target as Assignable, evaluate),
        target.name,
        target.loc,
      );
    const table = this.cell(target.target as Assignable, evaluate),
      type = table.type;
    if (type.kind !== 'table') throw new AbapError('An internal table is required.', target.loc);
    const rows = table.get() as DataValue[];
    const index = target.index
      ? checkedIndex(evaluate(target.index), target.loc) - 1
      : rows.findIndex((row) =>
          matchesKeys(
            row,
            target.keys ?? [],
            evaluate,
            target.loc,
            type.element,
            this.model.expressionTypes,
          ),
        );
    if (index < 0 || index >= rows.length) throw new AbapError('Table row not found.', target.loc);
    return {
      type: type.element,
      get: () => rows[index]!,
      set: (value, sourceType) => {
        rows[index] = convert(value, type.element, target.loc, sourceType);
      },
    };
  }
}
export function checkedIndex(value: DataValue, loc: Location): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1)
    throw new AbapError('Table index must be a positive integer.', loc);
  return n;
}
export function fieldValue(value: DataValue, name: string, loc: Location): DataValue {
  if (name === 'TABLE_LINE') return value;
  let result = value;
  for (const part of name.split('-')) {
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      result[part] === undefined
    )
      throw new AbapError(`Unknown structure component ${part}.`, loc);
    result = result[part]!;
  }
  return result;
}
export function matchesKeys(
  row: DataValue,
  keys: { name: string; value: Expression }[],
  evaluate: (expr: Expression) => DataValue,
  loc: Location,
  rowType?: AbapType,
  expressionTypes?: Map<Expression, AbapType>,
): boolean {
  return keys.every((key) => {
    let type = rowType;
    if (key.name !== 'TABLE_LINE')
      for (const part of key.name.split('-'))
        type = type?.kind === 'structure' ? type.fields[part] : undefined;
    const operand = evaluate(key.value);
    return (
      compare(
        fieldValue(row, key.name, loc),
        type ? convert(operand, type, loc, expressionTypes?.get(key.value)) : operand,
        loc,
        type,
        type,
      ) === 0
    );
  });
}
