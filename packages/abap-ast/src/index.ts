/** Syntax nodes are serializable and always retain their source location. */
export interface Location {
  line: number;
  column: number;
  offset: number;
}
export interface Node {
  loc: Location;
}
export class AbapError extends Error {
  constructor(
    message: string,
    public readonly loc: Location,
  ) {
    super(message);
    this.name = 'AbapError';
  }
  get line(): number {
    return this.loc.line;
  }
  get column(): number {
    return this.loc.column;
  }
}
export type TypeSpec =
  | { kind: 'named'; name: string; length?: number; decimals?: number }
  | { kind: 'structure'; fields: { name: string; type: TypeSpec; loc: Location }[] }
  | { kind: 'table'; element: TypeSpec };
export interface Program extends Node {
  kind: 'program';
  statements: Statement[];
}
export interface Reference extends Node {
  kind: 'reference';
  name: string;
}
export type Expression =
  | (Node & { kind: 'literal'; value: string | number | boolean; literalType?: 'string' | 'c' })
  | Reference
  | (Node & { kind: 'unary'; operator: string; operand: Expression })
  | (Node & { kind: 'binary'; operator: string; left: Expression; right: Expression })
  | (Node & { kind: 'initial'; operand: Expression; negate: boolean })
  | (Node & { kind: 'call'; name: string; args: Expression[] })
  | (Node & { kind: 'template'; parts: (string | Expression)[] })
  | (Node & { kind: 'component'; target: Expression; name: string })
  | (Node & {
      kind: 'tableAccess';
      target: Expression;
      index?: Expression;
      keys?: { name: string; value: Expression }[];
    })
  | (Node & {
      kind: 'value';
      typeName: string;
      fields: { name: string; value: Expression }[];
      rows: Expression[];
    })
  | (Node & { kind: 'convert'; typeName: string; value: Expression });
export type Assignable = Reference | Extract<Expression, { kind: 'component' | 'tableAccess' }>;
export interface Target extends Node {
  name: string;
  inline: boolean;
}
export type Statement =
  | (Node & { kind: 'report'; name: string })
  | (Node & { kind: 'event'; name: 'INITIALIZATION' | 'START-OF-SELECTION' | 'END-OF-SELECTION' })
  | (Node & { kind: 'type'; name: string; type: TypeSpec })
  | (Node & {
      kind: 'declare';
      name: string;
      type?: TypeSpec;
      value?: Expression;
      constant: boolean;
      parameter: boolean;
      inline: boolean;
    })
  | (Node & { kind: 'assign'; target: Assignable; value: Expression })
  | (Node & { kind: 'write'; items: { newline: boolean; value: Expression }[] })
  | (Node & { kind: 'clear'; targets: Assignable[] })
  | (Node & {
      kind: 'if';
      branches: { condition: Expression; body: Statement[] }[];
      otherwise: Statement[];
    })
  | (Node & {
      kind: 'case';
      value: Expression;
      branches: { values: Expression[]; body: Statement[] }[];
      otherwise: Statement[];
    })
  | (Node & { kind: 'do'; times?: Expression; body: Statement[] })
  | (Node & { kind: 'while'; condition: Expression; body: Statement[] })
  | (Node & {
      kind: 'loop';
      table: Expression;
      target: Target;
      body: Statement[];
      where?: Expression;
    })
  | (Node & {
      kind: 'control';
      action: 'CHECK' | 'CONTINUE' | 'EXIT' | 'RETURN';
      condition?: Expression;
    })
  | (Node & { kind: 'append'; table: Assignable; value: Expression; index?: Expression })
  | (Node & {
      kind: 'read';
      table: Expression;
      target?: Target;
      index?: Expression;
      keys?: { name: string; value: Expression }[];
    })
  | (Node & { kind: 'delete'; table: Assignable; index: Expression })
  | (Node & { kind: 'modify'; table: Assignable; value: Expression; index?: Expression })
  | (Node & {
      kind: 'sort';
      table: Assignable;
      fields: { name: string; descending: boolean }[];
      descending: boolean;
    })
  | (Node & {
      kind: 'concatenate';
      values: Expression[];
      target: Assignable;
      separator?: Expression;
    })
  | (Node & {
      kind: 'split';
      value: Expression;
      separator: Expression;
      targets: Assignable[];
      table?: Assignable;
    })
  | (Node & { kind: 'condense'; target: Assignable; noGaps: boolean });
