import { AbapError, type Location, type TypeSpec } from '../../abap-ast/src/index';
import type { DataValue } from '../../shared/src/index';
export type AbapType =
  | { kind: 'primitive'; name: string; length?: number; decimals?: number }
  | { kind: 'structure'; name: string; fields: Record<string, AbapType> }
  | { kind: 'table'; name: string; element: AbapType };
export const primitiveNames = [
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
export const numericNames = ['I', 'INT8', 'P', 'F', 'DECFLOAT16', 'DECFLOAT34'];
export const stringType: AbapType = { kind: 'primitive', name: 'STRING' };
export const integerType: AbapType = { kind: 'primitive', name: 'I' };
export const booleanType: AbapType = { kind: 'primitive', name: 'ABAP_BOOL', length: 1 };
export class TypeRegistry {
  readonly types = new Map<string, AbapType>();
  constructor() {
    for (const name of primitiveNames)
      this.types.set(name, {
        kind: 'primitive',
        name,
        ...(name === 'C' || name === 'N' || name === 'ABAP_BOOL' ? { length: 1 } : {}),
        ...(name === 'P' ? { length: 8, decimals: 0 } : {}),
      });
  }
  resolve(spec: TypeSpec, loc: Location): AbapType {
    if (spec.kind === 'table')
      return { kind: 'table', name: 'STANDARD TABLE', element: this.resolve(spec.element, loc) };
    if (spec.kind === 'structure') {
      const fields: Record<string, AbapType> = {};
      for (const field of spec.fields) {
        if (fields[field.name])
          throw new AbapError(`Duplicate component ${field.name}.`, field.loc);
        fields[field.name] = this.resolve(field.type, field.loc);
      }
      return { kind: 'structure', name: 'STRUCTURE', fields };
    }
    const type = this.types.get(spec.name);
    if (!type) throw new AbapError(`Unknown type ${spec.name}.`, loc);
    if (spec.length === undefined && spec.decimals === undefined) return type;
    if (type.kind !== 'primitive' || !['C', 'N', 'P'].includes(type.name))
      throw new AbapError(`LENGTH/DECIMALS is not valid for ${spec.name}.`, loc);
    if (
      spec.length !== undefined &&
      (!Number.isInteger(spec.length) ||
        spec.length < 1 ||
        spec.length > (type.name === 'P' ? 16 : 65535))
    )
      throw new AbapError(`Invalid LENGTH for ${spec.name}.`, loc);
    if (
      spec.decimals !== undefined &&
      (type.name !== 'P' ||
        !Number.isInteger(spec.decimals) ||
        spec.decimals < 0 ||
        spec.decimals > 14 ||
        spec.decimals > (spec.length ?? type.length ?? 8) * 2 - 1)
    )
      throw new AbapError(`Invalid DECIMALS for ${spec.name}.`, loc);
    return {
      ...type,
      ...(spec.length === undefined ? {} : { length: spec.length }),
      ...(spec.decimals === undefined ? {} : { decimals: spec.decimals }),
    };
  }
  register(name: string, spec: TypeSpec, loc: Location): void {
    if (this.types.has(name)) throw new AbapError(`Type ${name} is already defined.`, loc);
    const type = this.resolve(spec, loc);
    this.types.set(name, type.kind === 'primitive' ? type : { ...type, name });
  }
}
export function initialValue(type: AbapType): DataValue {
  if (type.kind === 'table') return [];
  if (type.kind === 'structure')
    return Object.fromEntries(
      Object.entries(type.fields).map(([name, field]) => [name, initialValue(field)]),
    );
  if (numericNames.includes(type.name)) return 0;
  if (type.name === 'N') return '0'.repeat(type.length ?? 1);
  if (type.name === 'D') return '00000000';
  if (type.name === 'T') return '000000';
  if (type.name === 'ABAP_BOOL') return ' ';
  if (type.name === 'C') return ' '.repeat(type.length ?? 1);
  return '';
}
export function cloneValue(value: DataValue): DataValue {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child)]),
    );
  return value;
}
export function numeric(value: DataValue, loc: Location): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'string') throw new AbapError('A numeric operand is required.', loc);
  const text = value.trim();
  if (!text) return 0;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text))
    throw new AbapError(`Cannot convert ${JSON.stringify(value)} to a number.`, loc);
  const n = Number(text);
  if (!Number.isFinite(n)) throw new AbapError('Numeric overflow.', loc);
  return n;
}
export function display(value: DataValue, type?: AbapType): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'X' : '';
  if (typeof value === 'object') return JSON.stringify(value);
  return type?.name === 'STRING' ? String(value) : String(value).trimEnd();
}
export function convert(
  value: DataValue,
  type: AbapType,
  loc: Location,
  sourceType?: AbapType,
): DataValue {
  if (type.kind === 'table') {
    if (!Array.isArray(value))
      throw new AbapError(`Cannot assign a non-table value to ${type.name}.`, loc);
    return value.map((row) =>
      convert(
        row,
        type.element,
        loc,
        sourceType?.kind === 'table' ? sourceType.element : undefined,
      ),
    );
  }
  if (type.kind === 'structure') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new AbapError(`Cannot assign a scalar value to structure ${type.name}.`, loc);
    const result: Record<string, DataValue> = {};
    for (const [name, field] of Object.entries(type.fields))
      result[name] =
        value[name] === undefined
          ? initialValue(field)
          : convert(
              value[name],
              field,
              loc,
              sourceType?.kind === 'structure' ? sourceType.fields[name] : undefined,
            );
    return result;
  }
  if (numericNames.includes(type.name)) {
    let n = numeric(value, loc);
    if (type.name === 'I' || type.name === 'INT8') n = Math.sign(n) * Math.floor(Math.abs(n) + 0.5);
    if (type.name === 'I' && (n < -2147483648 || n > 2147483647))
      throw new AbapError('Integer overflow for TYPE i.', loc);
    if (type.name === 'INT8' && !Number.isSafeInteger(n))
      throw new AbapError(
        'INT8 exceeds the exact integer range supported by this runtime (±9007199254740991).',
        loc,
      );
    if (type.name === 'P') {
      const scale = 10 ** (type.decimals ?? 0);
      n = (Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * scale)) / scale;
      if (Math.abs(n) >= 10 ** ((type.length ?? 8) * 2 - 1 - (type.decimals ?? 0)))
        throw new AbapError('Packed number overflow.', loc);
    }
    if (!Number.isFinite(n)) throw new AbapError('Numeric overflow.', loc);
    return Object.is(n, -0) ? 0 : n;
  }
  if (value !== null && typeof value === 'object')
    throw new AbapError(`Cannot convert a structure or table to ${type.name}.`, loc);
  const text =
    typeof value === 'boolean' ? (value ? 'X' : ' ') : value === null ? '' : String(value);
  if (type.name === 'C') return text.slice(0, type.length ?? 1).padEnd(type.length ?? 1);
  if (type.name === 'ABAP_BOOL') return text.slice(0, 1).padEnd(1);
  if (type.name === 'N') {
    const digits = text.replace(/\D/g, '');
    return digits.slice(-(type.length ?? 1)).padStart(type.length ?? 1, '0');
  }
  if (type.name === 'D' || type.name === 'T') {
    const length = type.name === 'D' ? 8 : 6;
    if (!/^\d*$/.test(text))
      throw new AbapError(`TYPE ${type.name.toLowerCase()} requires digits.`, loc);
    return text.slice(0, length).padEnd(length, '0');
  }
  return type.name === 'STRING' && sourceType?.name === 'C' ? text.trimEnd() : text;
}
export function truth(value: DataValue): boolean {
  return typeof value === 'string' ? value.trim() !== '' : Boolean(value);
}
export function compare(
  left: DataValue,
  right: DataValue,
  loc: Location,
  leftType?: AbapType,
  rightType?: AbapType,
): number {
  if (typeof left === 'number' || typeof right === 'number') {
    const a = numeric(left, loc),
      b = numeric(right, loc);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const stringComparison = leftType?.name === 'STRING' || rightType?.name === 'STRING';
  const a =
      typeof left === 'string'
        ? stringComparison && leftType?.name === 'STRING'
          ? left
          : left.trimEnd()
        : display(left),
    b =
      typeof right === 'string'
        ? stringComparison && rightType?.name === 'STRING'
          ? right
          : right.trimEnd()
        : display(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
export function isInitial(value: DataValue, type?: AbapType): boolean {
  if (type) return JSON.stringify(value) === JSON.stringify(initialValue(type));
  if (Array.isArray(value)) return !value.length;
  if (value && typeof value === 'object') return Object.values(value).every((v) => isInitial(v));
  return !truth(value);
}
export const builtinFunctions: Record<
  string,
  { result: AbapType; invoke: (args: DataValue[], loc: Location) => DataValue }
> = {
  STRLEN: { result: integerType, invoke: ([value]) => display(value ?? '').length },
  TO_UPPER: { result: stringType, invoke: ([value]) => String(value ?? '').toUpperCase() },
  TO_LOWER: { result: stringType, invoke: ([value]) => String(value ?? '').toLowerCase() },
  LINES: {
    result: integerType,
    invoke: ([value], loc) => {
      if (!Array.isArray(value)) throw new AbapError('LINES requires an internal table.', loc);
      return value.length;
    },
  },
  ABS: {
    result: { kind: 'primitive', name: 'F' },
    invoke: ([value], loc) => Math.abs(numeric(value ?? 0, loc)),
  },
  CEIL: { result: integerType, invoke: ([value], loc) => Math.ceil(numeric(value ?? 0, loc)) },
  FLOOR: { result: integerType, invoke: ([value], loc) => Math.floor(numeric(value ?? 0, loc)) },
  TRUNC: { result: integerType, invoke: ([value], loc) => Math.trunc(numeric(value ?? 0, loc)) },
  XSDBOOL: { result: booleanType, invoke: ([value]) => (truth(value ?? false) ? 'X' : ' ') },
  BOOLC: { result: stringType, invoke: ([value]) => (truth(value ?? false) ? 'X' : ' ') },
};
