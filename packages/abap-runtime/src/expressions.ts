import { AbapError, type Assignable, type Expression } from '../../abap-ast/src/index';
import {
  builtinFunctions,
  compare,
  convert,
  display,
  initialValue,
  isInitial,
  numeric,
  stringType,
  truth,
  type AbapType,
} from '../../abap-standard-library/src/index';
import type { DataValue } from '../../shared/src/index';
import { checkedIndex, Context, fieldValue, matchesKeys } from './context';
export class Expressions {
  constructor(readonly context: Context) {}
  evaluate = (expr: Expression): DataValue => {
    switch (expr.kind) {
      case 'literal':
        return expr.value;
      case 'reference':
        return this.context.row?.[expr.name] ?? this.context.reference(expr.name, expr.loc).get();
      case 'component':
        return fieldValue(this.evaluate(expr.target), expr.name, expr.loc);
      case 'tableAccess': {
        const rows = this.evaluate(expr.target);
        if (!Array.isArray(rows))
          throw new AbapError('Table expression requires an internal table.', expr.loc);
        const type = this.context.model.expressionTypes.get(expr.target);
        const index = expr.index
          ? checkedIndex(this.evaluate(expr.index), expr.loc) - 1
          : rows.findIndex((row) =>
              matchesKeys(
                row,
                expr.keys ?? [],
                this.evaluate,
                expr.loc,
                type?.kind === 'table' ? type.element : undefined,
                this.context.model.expressionTypes,
              ),
            );
        if (index < 0 || index >= rows.length)
          throw new AbapError('Table row not found.', expr.loc);
        return rows[index]!;
      }
      case 'unary': {
        const value = this.evaluate(expr.operand);
        return expr.operator === 'NOT'
          ? !truth(value)
          : expr.operator === '-'
            ? -numeric(value, expr.loc)
            : numeric(value, expr.loc);
      }
      case 'initial': {
        const result = isInitial(
          this.evaluate(expr.operand),
          this.context.model.expressionTypes.get(expr.operand),
        );
        return expr.negate ? !result : result;
      }
      case 'binary':
        return this.binary(expr);
      case 'template':
        return expr.parts
          .map((part) =>
            typeof part === 'string'
              ? part
              : display(this.evaluate(part), this.context.model.expressionTypes.get(part)),
          )
          .join('');
      case 'call': {
        const fn = builtinFunctions[expr.name];
        if (!fn) throw new AbapError(`Unknown function ${expr.name}.`, expr.loc);
        // ABAP strlen counts trailing blanks in STRING, but ignores them in C.
        if (expr.name === 'STRLEN') {
          const arg = expr.args[0]!,
            type = this.context.model.expressionTypes.get(arg),
            value = String(this.evaluate(arg));
          return type?.name === 'STRING' ? value.length : value.trimEnd().length;
        }
        return fn.invoke(expr.args.map(this.evaluate), expr.loc);
      }
      case 'convert':
        return convert(
          this.evaluate(expr.value),
          this.context.model.expressionTypes.get(expr) ?? stringType,
          expr.loc,
          this.context.model.expressionTypes.get(expr.value),
        );
      case 'value': {
        const type = this.context.model.expressionTypes.get(expr);
        if (!type) throw new AbapError('Cannot determine VALUE type.', expr.loc);
        if (type.kind === 'table')
          return expr.rows.map((row) =>
            convert(
              this.evaluate(row),
              type.element,
              row.loc,
              this.context.model.expressionTypes.get(row),
            ),
          );
        const result = initialValue(type);
        if (type.kind === 'structure')
          for (const field of expr.fields)
            (result as Record<string, DataValue>)[field.name] = convert(
              this.evaluate(field.value),
              type.fields[field.name]!,
              field.value.loc,
              this.context.model.expressionTypes.get(field.value),
            );
        return result;
      }
    }
  };
  private binary(expr: Extract<Expression, { kind: 'binary' }>): DataValue {
    const left = this.evaluate(expr.left);
    if (expr.operator === 'AND') return truth(left) && truth(this.evaluate(expr.right));
    if (expr.operator === 'OR') return truth(left) || truth(this.evaluate(expr.right));
    const right = this.evaluate(expr.right);
    const comparison: Record<string, (value: number) => boolean> = {
      '=': (n) => n === 0,
      EQ: (n) => n === 0,
      '<>': (n) => n !== 0,
      NE: (n) => n !== 0,
      '<': (n) => n < 0,
      LT: (n) => n < 0,
      '>': (n) => n > 0,
      GT: (n) => n > 0,
      '<=': (n) => n <= 0,
      LE: (n) => n <= 0,
      '>=': (n) => n >= 0,
      GE: (n) => n >= 0,
    };
    const comparator = comparison[expr.operator];
    if (comparator)
      return comparator(
        compare(
          left,
          right,
          expr.loc,
          this.context.model.expressionTypes.get(expr.left),
          this.context.model.expressionTypes.get(expr.right),
        ),
      );
    if (expr.operator === '&&')
      return (
        String(
          convert(left, stringType, expr.loc, this.context.model.expressionTypes.get(expr.left)),
        ) +
        String(
          convert(right, stringType, expr.loc, this.context.model.expressionTypes.get(expr.right)),
        )
      );
    const a = numeric(left, expr.loc),
      b = numeric(right, expr.loc);
    if (['/', 'DIV', 'MOD'].includes(expr.operator) && b === 0)
      throw new AbapError('Division by zero.', expr.loc);
    // ABAP MOD is non-negative; DIV is the corresponding Euclidean quotient.
    const remainder = ((a % Math.abs(b)) + Math.abs(b)) % Math.abs(b);
    const result =
      expr.operator === '+'
        ? a + b
        : expr.operator === '-'
          ? a - b
          : expr.operator === '*'
            ? a * b
            : expr.operator === '/'
              ? a / b
              : expr.operator === 'MOD'
                ? remainder
                : Math.round((a - remainder) / b);
    if (!Number.isFinite(result)) throw new AbapError('Numeric overflow.', expr.loc);
    return result;
  }
  assign(target: Assignable, value: DataValue, sourceType?: AbapType): void {
    this.context.cell(target, this.evaluate).set(value, sourceType);
  }
}
