import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { checkProgram } from '../packages/abap-language-service/src/index';
import { executeProgram } from '../packages/abap-runtime/src/index';

const peopleTypes = `TYPES: BEGIN OF ty_person,
  name TYPE string,
  age TYPE i,
END OF ty_person.
TYPES ty_people TYPE STANDARD TABLE OF ty_person WITH EMPTY KEY.\n`;

const errors = (source: string) =>
  checkProgram(source).diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
const output = async (source: string) => {
  expect(errors(source)).toEqual([]);
  return (await executeProgram(source)).output.trim();
};

describe('independent supported-subset regression checks', () => {
  it.each([
    ['modern-syntax/hello', 'Hello World'],
    ['internal-tables/people', 'Alice 30\nBob 25'],
  ])('executes the exact %s milestone fixture', async (fixture, expected) => {
    expect(await output(await readFile(`tests/abap/${fixture}.abap`, 'utf8'))).toBe(expected);
  });

  it('restores the outer DO index after a nested DO finishes', async () => {
    // SAP DO semantics: sy-index refers to the currently active loop.
    // https://help.sap.com/docs/abap-cloud/abap-keyword/abapdo.html
    expect(
      await output(`DO 2 TIMES.
  WRITE / sy-index.
  DO 2 TIMES.
    WRITE / sy-index.
  ENDDO.
  WRITE / sy-index.
ENDDO.`),
    ).toBe('1\n1\n2\n1\n2\n1\n2\n2');
  });

  it('evaluates DO TIMES once and does not execute zero or negative loops', async () => {
    expect(
      await output(`DATA(lv_count) = 3.
DATA(lv_visits) = 0.
DO lv_count TIMES.
  lv_count = 0.
  lv_visits = lv_visits + 1.
ENDDO.
DO 0 TIMES.
  WRITE 'Unexpected'.
ENDDO.
DO -1 TIMES.
  WRITE 'Unexpected'.
ENDDO.
WRITE lv_visits.`),
    ).toBe('3');
  });

  it('rejects misspelled structure components and table key components', () => {
    for (const statement of [
      'WRITE ls_person-nmae.',
      'ls_person-nmae = `Bob`.',
      'READ TABLE lt_people INTO ls_person WITH KEY nmae = `Alice`.',
    ]) {
      const source =
        peopleTypes +
        'DATA ls_person TYPE ty_person.\nDATA lt_people TYPE ty_people.\n' +
        statement;
      expect(errors(source).some((error) => /component NMAE/i.test(error.message))).toBe(true);
    }
  });

  it('APPEND and READ INTO copy structures rather than sharing mutable references', async () => {
    expect(
      await output(
        peopleTypes +
          `DATA(ls_person) = VALUE ty_person( name = 'Alice' age = 30 ).
DATA lt_people TYPE ty_people.
APPEND ls_person TO lt_people.
ls_person-name = 'Changed'.
READ TABLE lt_people INTO DATA(ls_copy) INDEX 1.
ls_copy-name = 'Local'.
WRITE lt_people[ 1 ]-name.`,
      ),
    ).toBe('Alice');
  });

  it('copies internal table rows on assignment, including nested structure values', async () => {
    expect(
      await output(
        peopleTypes +
          `DATA(lt_people) = VALUE ty_people( ( name = 'Alice' age = 30 ) ).
DATA(lt_copy) = lt_people.
lt_copy[ 1 ]-name = 'Bob'.
APPEND VALUE ty_person( name = 'Carol' age = 20 ) TO lt_copy.
WRITE: lt_people[ 1 ]-name, lines( lt_people ), lt_copy[ 1 ]-name, lines( lt_copy ).`,
      ),
    ).toBe('Alice 1 Bob 2');
  });

  it('keeps an existing INTO target unchanged when READ TABLE finds no row', async () => {
    expect(
      await output(
        peopleTypes +
          `DATA lt_people TYPE ty_people.
DATA(ls_person) = VALUE ty_person( name = 'Keep' age = 42 ).
READ TABLE lt_people INTO ls_person INDEX 1.
WRITE: sy-subrc, ls_person-name, ls_person-age.`,
      ),
    ).toBe('4 Keep 42');
  });

  it('performs explicit character-to-integer CONV and preserves string-to-string blanks', async () => {
    const source =
      'DATA(lv_number) = CONV i( `0042` ).\nDATA(lv_string) = CONV string( `ABAP  ` ).\nWRITE: lv_number, strlen( lv_string ).';
    expect(await output(source)).toBe('42 6');
    const result = await executeProgram(source);
    expect(result.variables.find((variable) => variable.name === 'LV_STRING')?.value).toBe(
      'ABAP  ',
    );
  });

  it('truncates trailing C blanks when CONV converts a text field to string', async () => {
    // SAP conversion rules distinguish C blanks from STRING blanks.
    // https://github.com/SAP-samples/abap-cheat-sheets/blob/main/07_String_Processing.md
    expect(
      await output(`DATA lv_chars TYPE c LENGTH 6 VALUE 'ABAP'.
DATA(lv_string) = CONV string( lv_chars ).
WRITE strlen( lv_string ).`),
    ).toBe('4');
  });

  it('treats trailing STRING blanks as significant in comparisons', async () => {
    // SAP: operands of type STRING with different lengths never compare equal.
    // https://help.sap.com/doc/abapdocu_752_index_htm/7.52/en-US/abenlogexp_character.htm
    expect(
      await output('IF `ABAP` = `ABAP `.\n  WRITE `Wrong`.\nELSE.\n  WRITE `Different`.\nENDIF.'),
    ).toBe('Different');
  });

  it.each(['/', 'DIV', 'MOD'])('reports division by zero for the %s operator', async (operator) => {
    const source = `DATA(lv_result) = 1 ${operator} 0.\nWRITE lv_result.`;
    expect(errors(source)).toEqual([]);
    await expect(executeProgram(source)).rejects.toThrow(/division by zero/i);
  });

  it('short-circuits AND and OR without evaluating a failing expression', async () => {
    expect(
      await output(`IF 1 = 2 AND 1 / 0 = 1.
  WRITE 'Wrong'.
ENDIF.
IF 1 = 1 OR 1 / 0 = 1.
  WRITE 'Safe'.
ENDIF.`),
    ).toBe('Safe');
  });

  it.each(['lc_count = 2.', 'CLEAR lc_count.', 'FREE lc_count.', 'MOVE 2 TO lc_count.'])(
    'rejects constant mutation via %s',
    async (statement) => {
      const source = 'CONSTANTS lc_count TYPE i VALUE 1.\n' + statement;
      expect(errors(source).some((error) => /constant LC_COUNT/i.test(error.message))).toBe(true);
      await expect(executeProgram(source)).rejects.toThrow(/constant/i);
    },
  );

  it('bounds even an empty unending DO with the configured statement budget', async () => {
    await expect(
      executeProgram('DO.\nENDDO.', { maxStatements: 25, timeoutMs: 1000 }),
    ).rejects.toThrow(/statement limit/i);
    expect(await output('WRITE `Fresh`.')).toBe('Fresh');
  });
});
