import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tokenize } from '../packages/abap-lexer/src/index';
import { parseProgram } from '../packages/abap-parser/src/index';
import { checkProgram, formatProgram } from '../packages/abap-language-service/src/index';
import { executeProgram } from '../packages/abap-runtime/src/index';
const run = async (source: string): Promise<string> => (await executeProgram(source)).output;
const structure = `TYPES: BEGIN OF ty_person, name TYPE string, age TYPE i, END OF ty_person.
TYPES ty_people TYPE STANDARD TABLE OF ty_person WITH EMPTY KEY.`;
function fixtures(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? fixtures(join(directory, entry.name))
      : entry.name.endsWith('.abap')
        ? [join(directory, entry.name)]
        : [],
  );
}

describe('real ABAP compatibility fixtures', () => {
  for (const path of fixtures(join(process.cwd(), 'tests', 'abap'))) {
    it(path.split(/[\\/]/).slice(-2).join('/'), async () => {
      const source = readFileSync(path, 'utf8'),
        expected = readFileSync(path.replace('.abap', '.expected.txt'), 'utf8').trimEnd();
      expect(checkProgram(source).diagnostics).toEqual([]);
      expect(parseProgram(source).kind).toBe('program');
      expect(await run(source)).toBe(expected);
    });
  }
});
describe('lexer and source coordinates', () => {
  it('handles case-insensitive words, component names, escaped literals and comments', () => {
    const tokens = tokenize("* Full comment\nwrite: / 'It''s', `a``b`, sy-subrc. \" inline\n");
    expect(tokens.map((token) => token.value)).toEqual([
      'WRITE',
      ':',
      '/',
      "It's",
      ',',
      'a`b',
      ',',
      'SY-SUBRC',
      '.',
      '<EOF>',
    ]);
    expect(tokens[0]?.loc).toMatchObject({ line: 2, column: 1 });
  });
  it('distinguishes decimal values, periods and operators', () => {
    expect(tokenize('1.25. 2 >= 1 AND 3 <> 4 && `x`.').map((token) => token.value)).toEqual([
      '1.25',
      '.',
      '2',
      '>=',
      '1',
      'AND',
      '3',
      '<>',
      '4',
      '&&',
      'x',
      '.',
      '<EOF>',
    ]);
  });
  it.each(["WRITE 'oops.", 'WRITE `oops.', 'WRITE |Hello { x }.', 'WRITE @x.', 'WRITE |bad }|.'])(
    'rejects malformed token stream %s',
    (source) => {
      expect(() => tokenize(source)).toThrow();
      expect(checkProgram(source).diagnostics[0]?.severity).toBe('error');
    },
  );
  it('template AST contains expression nodes and source positions', () => {
    const ast = parseProgram('DATA(name) = `W`.\nWRITE |Hello { name }|.');
    const write = ast.statements[1];
    expect(write?.kind).toBe('write');
    if (write?.kind !== 'write') throw new Error('write');
    const expr = write.items[0]?.value;
    expect(expr?.kind).toBe('template');
    if (expr?.kind !== 'template') throw new Error('template');
    expect(expr.parts[1]).toMatchObject({
      kind: 'reference',
      name: 'NAME',
      loc: { line: 2, column: 16 },
    });
  });
  it('retains explicit VALUE/table/loop AST nodes', () => {
    const ast = parseProgram(
      `${structure} DATA(people) = VALUE ty_people( ( name = 'A' age = 1 ) ). LOOP AT people INTO DATA(person). WRITE person-name. ENDLOOP.`,
    );
    expect(ast.statements.map((s) => s.kind)).toEqual(['type', 'type', 'declare', 'loop']);
    expect(ast.statements[2]).toMatchObject({
      value: {
        kind: 'value',
        rows: [{ kind: 'value', fields: [{ name: 'NAME' }, { name: 'AGE' }] }],
      },
    });
  });
});
describe('declarations and ABAP values', () => {
  it('supports PROGRAM, classic DATA, inline DATA/FINAL, aliases, constants, MOVE, CLEAR and FREE', async () => {
    expect(
      await run(
        'PROGRAM ztest. TYPES amount TYPE i. CONSTANTS c TYPE amount VALUE 4. DATA a TYPE amount. MOVE c TO a. FINAL(b) = `hi`. WRITE: a, b. CLEAR a. WRITE a. FREE a.',
      ),
    ).toBe('4 hi 0');
  });
  it.each(['i', 'int8', 'p', 'f', 'decfloat16', 'decfloat34'])(
    'numeric initial and assignment for %s',
    async (type) => {
      expect(await run(`DATA n TYPE ${type}. WRITE n. n = 12. WRITE n.`)).toBe('0 12');
    },
  );
  it('dates, times, bool, fixed-length and numeric text initial values', async () => {
    expect(
      await run(
        "DATA: date TYPE d, time TYPE t, bool TYPE abap_bool, number TYPE n LENGTH 3, text TYPE c LENGTH 4. WRITE: date, time, number. bool = abap_true. IF bool = abap_true AND text IS INITIAL. WRITE 'true'. ENDIF.",
      ),
    ).toBe('00000000 000000 000 true');
  });
  it('rounds integer assignment half away from zero, pads/truncates C and N', async () => {
    expect(
      await run(
        "DATA: a TYPE i, b TYPE c LENGTH 3, n TYPE n LENGTH 4. a = -2.5. b = 'abcde'. n = 'x27'. WRITE: a, b, n.",
      ),
    ).toBe('-3 abc 0027');
  });
  it('initializes structure values and copies assignments by value', async () => {
    expect(
      await run(
        `${structure} DATA(a) = VALUE ty_person( name = 'Alice' ). DATA b TYPE ty_person. b = a. b-name = 'Bob'. WRITE: a-name, a-age, b-name.`,
      ),
    ).toBe('Alice 0 Bob');
  });
  it('accepts DATA BEGIN OF, nested structures and explicit CONV', async () => {
    expect(
      await run(
        "TYPES: BEGIN OF inner, count TYPE i, END OF inner. DATA: BEGIN OF outer, detail TYPE inner, END OF outer. outer-detail-count = CONV i( '4' ). WRITE outer-detail-count.",
      ),
    ).toBe('4');
  });
  it('enforces overflow and invalid dynamic numeric conversion', async () => {
    await expect(run('DATA x TYPE i. x = 2147483647. x = x + 1.')).rejects.toThrow('overflow');
    await expect(run('DATA x TYPE int8. x = 9007199254740992.')).rejects.toThrow(
      'exact integer range',
    );
    await expect(
      run("DATA text TYPE string VALUE 'bad'. DATA i TYPE i. i = text."),
    ).rejects.toThrow('Cannot convert');
  });
});
describe('expressions and conditions', () => {
  it('respects arithmetic, comparison and boolean precedence including NOT', async () => {
    expect(
      await run(
        'DATA(x) = 2 + 3 * 4. IF NOT x EQ 13 AND x GE 14 OR x LT 0. WRITE x. ENDIF. WRITE ( 11 DIV 3 ). WRITE ( 11 MOD 3 ).',
      ),
    ).toBe('14 3 2');
  });
  it('implements signed Euclidean DIV and MOD', async () => {
    expect(await run('WRITE: ( -7 DIV 3 ), ( -7 MOD 3 ), ( 7 DIV -3 ), ( 7 MOD -3 ).')).toBe(
      '-3 2 -2 1',
    );
  });
  it('short-circuits boolean operators', async () => {
    expect(
      await run(
        "IF 1 = 1 OR 1 / 0 = 1. WRITE 'ok'. ENDIF. IF 1 = 0 AND 1 / 0 = 0. WRITE 'bad'. ENDIF.",
      ),
    ).toBe('ok');
  });
  it('runs ELSEIF/ELSE, CASE multiple values and OTHERS', async () => {
    expect(
      await run(
        "IF 1 = 0. WRITE 'bad'. ELSEIF 2 = 2. WRITE 'elseif'. ELSE. WRITE 'bad'. ENDIF. CASE 4. WHEN 1 OR 2. WRITE 'bad'. WHEN OTHERS. WRITE 'others'. ENDCASE.",
      ),
    ).toBe('elseif others');
  });
  it('supports IS NOT INITIAL and character comparisons ignoring trailing blanks', async () => {
    expect(
      await run(
        "DATA c TYPE c LENGTH 5 VALUE 'X'. IF c IS NOT INITIAL AND c = 'X'. WRITE 'ok'. ENDIF.",
      ),
    ).toBe('ok');
  });
  it('reports division by zero with a line', async () => {
    await expect(executeProgram('REPORT z.\nWRITE 1 / 0.')).rejects.toMatchObject({
      line: 2,
      message: 'Division by zero.',
    });
  });
});
describe('loops and control flow', () => {
  it('DO, WHILE, CHECK, CONTINUE, EXIT and RETURN', async () => {
    expect(
      await run(
        "DO 5 TIMES. IF sy-index = 2. CONTINUE. ENDIF. IF sy-index = 4. EXIT. ENDIF. WRITE sy-index. ENDDO. RETURN. WRITE 'bad'.",
      ),
    ).toBe('1 3');
    expect(await run("CHECK 1 = 0. WRITE 'bad'.")).toBe('');
  });
  it('nested loops preserve the outer SY-INDEX', async () => {
    expect(
      await run(
        'DO 2 TIMES. WRITE sy-index. DO 1 TIMES. WRITE sy-index. ENDDO. WRITE sy-index. ENDDO.',
      ),
    ).toBe('1 1 1 2 1 2');
  });
  it('negative and zero DO counts do not execute', async () => {
    expect(await run("DO 0 TIMES. WRITE 'bad'. ENDDO. DO -1 TIMES. WRITE 'bad'. ENDDO.")).toBe('');
  });
  it.each(['DO. ENDDO.', 'WHILE 1 = 1. ENDWHILE.'])(
    'bounds empty infinite loops: %s',
    async (source) => {
      await expect(executeProgram(source, { maxStatements: 20 })).rejects.toThrow(
        'statement limit',
      );
    },
  );
  it('enforces wall timeout', async () => {
    await expect(
      executeProgram('DO. ENDDO.', { timeoutMs: 1, maxStatements: 100000000 }),
    ).rejects.toThrow('timeout');
  });
});
describe('internal tables', () => {
  it('APPEND, INSERT INDEX, READ INDEX/KEY, MODIFY, DELETE, SORT and LINES', async () => {
    expect(
      await run(`${structure}
DATA people TYPE ty_people.
APPEND VALUE #( name = 'Bob' age = 25 ) TO people.
INSERT VALUE #( name = 'Alice' age = 30 ) INTO people INDEX 1.
READ TABLE people INTO DATA(person) INDEX 2.
WRITE: person-name, sy-subrc, sy-tabix.
person-age = 26. MODIFY people FROM person INDEX 2.
SORT people BY age DESCENDING.
READ TABLE people WITH KEY name = 'Bob' INTO DATA(found).
WRITE: / found-age, lines( people ).
DELETE people INDEX 1.
WRITE: / people[ 1 ]-name, people[ name = 'Bob' ]-age.`),
    ).toBe('Bob 0 2\n26 2\nBob 26');
  });
  it('supports primitive rows, VALUE #, APPEND, and TRANSPORTING NO FIELDS', async () => {
    expect(
      await run(
        'TYPES numbers TYPE STANDARD TABLE OF i WITH EMPTY KEY. DATA values TYPE numbers. values = VALUE #( ( 3 ) ( 1 ) ( 2 ) ). SORT values. READ TABLE values WITH KEY table_line = 2 TRANSPORTING NO FIELDS. WRITE: sy-tabix, sy-subrc, values[ 1 ].',
      ),
    ).toBe('2 0 1');
  });
  it('READ miss sets subrc 4 and preserves the target, failed index operations report subrc', async () => {
    expect(
      await run(
        'DATA table TYPE STANDARD TABLE OF i. APPEND 1 TO table. DATA row TYPE i VALUE 9. READ TABLE table INTO row INDEX 2. WRITE: row, sy-subrc. DELETE table INDEX 9. WRITE sy-subrc. INSERT 2 INTO table INDEX 9. WRITE: sy-subrc, lines( table ).',
      ),
    ).toBe('9 4 4 4 1');
  });
  it('LOOP copies rows, WHERE filters components, MODIFY updates current row', async () => {
    expect(
      await run(
        `${structure} DATA(people) = VALUE ty_people( ( name = 'A' age = 10 ) ( name = 'B' age = 20 ) ). LOOP AT people INTO DATA(person) WHERE age > 10. person-age = 21. MODIFY people FROM person. ENDLOOP. WRITE: people[ 1 ]-age, people[ 2 ]-age.`,
      ),
    ).toBe('10 21');
  });
  it('WHERE supports TABLE_LINE for elementary rows', async () => {
    expect(
      await run(
        'TYPES nums TYPE STANDARD TABLE OF i. DATA(t) = VALUE nums( ( 1 ) ( 2 ) ( 3 ) ). LOOP AT t INTO DATA(n) WHERE table_line > 1. WRITE n. ENDLOOP.',
      ),
    ).toBe('2 3');
  });
  it('table key matching converts operands and preserves significant string blanks', async () => {
    expect(
      await run(
        "TYPES texts TYPE STANDARD TABLE OF string. DATA(t) = VALUE texts( ( `A ` ) ( `A` ) ). READ TABLE t WITH KEY table_line = `A` TRANSPORTING NO FIELDS. WRITE sy-tabix. DATA c TYPE c LENGTH 4 VALUE 'A'. READ TABLE t WITH KEY table_line = c TRANSPORTING NO FIELDS. WRITE sy-tabix.",
      ),
    ).toBe('2 2');
    expect(
      await run(
        `${structure} DATA(t) = VALUE ty_people( ( name = '12' age = 1 ) ). READ TABLE t WITH KEY name = 12 TRANSPORTING NO FIELDS. WRITE sy-subrc.`,
      ),
    ).toBe('0');
  });
  it('deleting the current row during LOOP does not skip the next row', async () => {
    expect(
      await run(
        'TYPES nums TYPE STANDARD TABLE OF i. DATA(t) = VALUE nums( ( 1 ) ( 2 ) ( 3 ) ). LOOP AT t INTO DATA(n). WRITE n. DELETE t INDEX sy-tabix. ENDLOOP. WRITE lines( t ).',
      ),
    ).toBe('1 2 3 0');
  });
  it('nested table assignments do not alias original rows', async () => {
    expect(
      await run(
        `${structure} DATA(a) = VALUE ty_people( ( name = 'A' age = 1 ) ). DATA b TYPE ty_people. b = a. b[ 1 ]-age = 2. WRITE: a[ 1 ]-age, b[ 1 ]-age.`,
      ),
    ).toBe('1 2');
  });
  it('empty table loops set subrc 4 and leave an initial inline target', async () => {
    expect(
      await run(
        'DATA t TYPE STANDARD TABLE OF i. LOOP AT t INTO DATA(row). WRITE row. ENDLOOP. WRITE: sy-subrc, row.',
      ),
    ).toBe('4 0');
  });
  it('rejects missing rows and non-positive table indices', async () => {
    await expect(run('DATA t TYPE STANDARD TABLE OF i. WRITE t[ 1 ].')).rejects.toThrow(
      'row not found',
    );
    await expect(
      run('DATA t TYPE STANDARD TABLE OF i. READ TABLE t INDEX 0 TRANSPORTING NO FIELDS.'),
    ).rejects.toThrow('positive integer');
  });
});
describe('strings, builtins and report events', () => {
  it('handles escaped templates and embedded expressions', async () => {
    expect(await run('DATA(n) = 2. WRITE |A\\n\\{ { n + 1 } \\} \\| \\\\|.')).toBe('A\n{ 3 } | \\');
  });
  it('string concatenation, conversion and functions', async () => {
    expect(
      await run(
        "DATA text TYPE string. text = 'A' && 'b'. WRITE: to_lower( text ), to_upper( text ), strlen( text ), abs( -3 ), ceil( '2.1' ), floor( '2.9' ), trunc( '-2.9' ), xsdbool( 1 = 1 ), boolc( 2 = 2 ).",
      ),
    ).toBe('ab AB 2 3 3 2 -2 X X');
  });
  it('STRLEN distinguishes trailing blanks in strings and C', async () => {
    expect(
      await run(
        "DATA s TYPE string VALUE `a  `. DATA c TYPE c LENGTH 3 VALUE 'a'. WRITE: strlen( s ), strlen( c ).",
      ),
    ).toBe('3 1');
  });
  it('preserves string blanks through CASE, assignment, templates and concatenation', async () => {
    expect(
      await run(
        "DATA c TYPE c LENGTH 4 VALUE 'A'. DATA s TYPE string. s = c. WRITE strlen( s ). s = `A `. WRITE strlen( s ). CASE s. WHEN `A`. WRITE 'bad'. WHEN OTHERS. WRITE 'different'. ENDCASE. DATA(t) = |>{ s }<|. WRITE t. DATA(u) = c && `B `. WRITE strlen( u ).",
      ),
    ).toBe('1 2 different >A < 3');
  });
  it('CONDENSE, NO-GAPS and SPLIT INTO TABLE', async () => {
    expect(
      await run(
        "DATA(text) = `  a   b  `. CONDENSE text. WRITE text. CONDENSE text NO-GAPS. WRITE text. DATA t TYPE STANDARD TABLE OF string. SPLIT 'x,y,z' AT ',' INTO TABLE t. WRITE: lines( t ), t[ 2 ].",
      ),
    ).toBe('a b ab 3 y');
  });
  it('selection parameters report defaults and apply supplied values', async () => {
    const source =
      "PARAMETERS: p_name TYPE string DEFAULT 'World', p_count TYPE i DEFAULT 2. WRITE |Hello { p_name } { p_count }|.";
    expect(checkProgram(source).parameters).toEqual([
      { name: 'P_NAME', type: 'string', defaultValue: 'World' },
      { name: 'P_COUNT', type: 'i', defaultValue: '2' },
    ]);
    expect(
      (await executeProgram(source, { parameters: { p_name: 'Alice', p_count: '4' } })).output,
    ).toBe('Hello Alice 4');
    expect(await run(source)).toBe('Hello World 2');
  });
  it('orders report events independently of source order and exposes system fields', async () => {
    expect(
      await run(
        "REPORT z. DATA n TYPE i. END-OF-SELECTION. WRITE 'end'. START-OF-SELECTION. WRITE n. INITIALIZATION. n = 5.",
      ),
    ).toBe('5 end');
    const result = await executeProgram('WRITE sy-uname.');
    expect(result.output).toBe('LOCAL');
    expect(result.variables.find((v) => v.name === 'SY-DATUM')?.value).toMatch(/^\d{8}$/);
    expect(result.variables.find((v) => v.name === 'SY-UZEIT')?.value).toMatch(/^\d{6}$/);
  });
  it('runs implicit start statements after INITIALIZATION and applies user parameters afterwards', async () => {
    expect(
      await run("WRITE 'start'. INITIALIZATION. WRITE 'init'. END-OF-SELECTION. WRITE 'end'."),
    ).toBe('init start end');
    const source =
      "PARAMETERS p_name TYPE string DEFAULT 'World'. INITIALIZATION. p_name = 'Initialized'. START-OF-SELECTION. WRITE p_name.";
    expect(await run(source)).toBe('Initialized');
    expect((await executeProgram(source, { parameters: { p_name: 'User' } })).output).toBe('User');
  });
  it('INITIALIZATION observes declared parameter defaults before user input is applied', async () => {
    const source =
      "PARAMETERS p_name TYPE string DEFAULT 'World'. INITIALIZATION. WRITE p_name. START-OF-SELECTION. WRITE p_name.";
    expect((await executeProgram(source, { parameters: { p_name: 'User' } })).output).toBe(
      'World User',
    );
    expect(await run(source)).toBe('World World');
  });
});
describe('semantic errors and unsupported syntax', () => {
  it.each([
    ['WRITE missing.', 'Unknown variable'],
    ['DATA x TYPE unknown.', 'Unknown type'],
    ['DATA x TYPE i. DATA x TYPE i.', 'already declared'],
    ['CONSTANTS x TYPE i VALUE 1. x = 2.', 'constant'],
    ['DATA x TYPE c LENGTH 0.', 'LENGTH'],
    ['DATA x TYPE string DECIMALS 2.', 'LENGTH/DECIMALS'],
    ['DATA x TYPE p DECIMALS 15.', 'DECIMALS'],
    [`${structure} DATA p TYPE ty_person. WRITE p-missing.`, 'component'],
    [`${structure} DATA p TYPE ty_person. p = 1.`, 'Cannot assign'],
    ['DATA(x) = VALUE #( ).', 'cannot be inferred'],
    [`${structure} DATA(p) = VALUE ty_person( name = 'a' name = 'b' ).`, 'Duplicate component'],
    ['WRITE unknown_func( 1 ).', 'unsupported function'],
    ['WRITE strlen( ).', 'exactly one'],
    ['WRITE lines( 1 ).', 'internal table'],
    ['CONTINUE.', 'inside a loop'],
    [
      'DATA t TYPE STANDARD TABLE OF i. DO 1 TIMES. MODIFY t FROM 1. ENDDO.',
      'INDEX outside LOOP AT',
    ],
    ['SELECT * FROM zpeople.', 'not supported'],
    ['CLASS lcl DEFINITION.', 'not supported'],
    ['DATA t TYPE SORTED TABLE OF i WITH UNIQUE KEY table_line.', 'Only STANDARD TABLE'],
    ['IF 1 = 1. WRITE 1.', 'Expected ENDIF'],
    ['WRITE 1', 'Expected .'],
    ['TYPES: BEGIN OF a, x TYPE i, END OF b.', 'does not match'],
    ['READ TABLE x INTO DATA(y).', 'requires INDEX'],
  ])('locates invalid code: %s', (source, message) => {
    const diagnostics = checkProgram(source).diagnostics;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.message).toContain(message);
    expect(diagnostics[0]?.line).toBeGreaterThan(0);
    expect(diagnostics[0]?.column).toBeGreaterThan(0);
  });
  it('collects independent semantic diagnostics with exact lines', () => {
    expect(
      checkProgram('WRITE missing.\nWRITE other.').diagnostics.map((d) => [d.line, d.message]),
    ).toEqual([
      [1, 'Unknown variable MISSING.'],
      [2, 'Unknown variable OTHER.'],
    ]);
  });
});
describe('formatter and debugger', () => {
  it('indents nested branches and CASE with idempotence', () => {
    const source =
      "CASE 1.\nWHEN 1.\nIF 1 = 1.\nWRITE 'x'.\nELSE.\nWRITE 'y'.\nENDIF.\nWHEN OTHERS.\nWRITE 'z'.\nENDCASE.";
    const formatted = formatProgram(source);
    expect(formatted).toBe(
      "CASE 1.\n  WHEN 1.\n    IF 1 = 1.\n      WRITE 'x'.\n    ELSE.\n      WRITE 'y'.\n    ENDIF.\n  WHEN OTHERS.\n    WRITE 'z'.\nENDCASE.",
    );
    expect(formatProgram(formatted)).toBe(formatted);
  });
  it('preserves multiline templates, literal spacing and comment contents', async () => {
    const source =
      'DATA x TYPE string.\nIF 1 = 1.\nx = |  first\n    second  \n third  |.\nWRITE x.\nENDIF.';
    const formatted = formatProgram(source);
    expect(await run(formatted)).toBe(await run(source));
    expect(formatProgram(formatted)).toBe(formatted);
    expect(formatProgram("WRITE 'unfinished")).toBe("WRITE 'unfinished");
  });
  it('pauses before statements with detached variable snapshots and streams exact output', async () => {
    const seen: { line: number; value: unknown }[] = [],
      chunks: string[] = [];
    const result = await executeProgram("DATA n TYPE i.\nn = 7.\nWRITE n.\nWRITE / 'done'.", {
      onStatement: async (snapshot) => {
        seen.push({
          line: snapshot.line,
          value: snapshot.variables.find((v) => v.name === 'N')?.value,
        });
      },
      onOutput: (text) => {
        chunks.push(text);
      },
    });
    expect(seen).toEqual([
      { line: 1, value: 0 },
      { line: 2, value: 0 },
      { line: 3, value: 7 },
      { line: 4, value: 7 },
    ]);
    expect(chunks.join('')).toBe(result.output);
    expect(result.output).toBe('7\ndone');
  });
});
