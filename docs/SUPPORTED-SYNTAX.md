# Supported ABAP syntax

ABAP Studio 0.1.0 interprets a deliberately bounded procedural ABAP subset. Source is tokenized, parsed into explicit AST nodes, checked against a symbol/type table, and interpreted. There is no generated JavaScript, `eval`, native compilation, SAP connection, or database.

The examples below are executable compatibility fixtures. Unsupported statements and additions are rejected; editor autocomplete also contains future ABAP keywords and does not imply runtime support.

## Verified milestones

### Hello World

```abap
REPORT zhello_world.

DATA(lv_name) = `World`.

WRITE |Hello { lv_name }|.
```

Output:

```text
Hello World
```

### Structures and internal tables

```abap
REPORT zinternal_table.

TYPES:
  BEGIN OF ty_person,
    name TYPE string,
    age  TYPE i,
  END OF ty_person.

TYPES ty_people TYPE STANDARD TABLE OF ty_person WITH EMPTY KEY.

DATA(lt_people) = VALUE ty_people(
  ( name = `Alice` age = 30 )
  ( name = `Bob`   age = 25 )
).

LOOP AT lt_people INTO DATA(ls_person).
  WRITE: / ls_person-name, ls_person-age.
ENDLOOP.
```

Output:

```text
Alice 30
Bob 25
```

## Source and declarations

Identifiers and keywords are case-insensitive. Names use ASCII letters, digits, and underscores; a hyphen selects a structure component or names a system field. Put spaces around subtraction between identifiers. Statements end with a period.

- `REPORT name.` and `PROGRAM name.`
- `DATA name TYPE type.` and chained `DATA: a TYPE i, b TYPE string.`
- `DATA(name) = expression.` and immutable `FINAL(name) = expression.`
- `CONSTANTS name TYPE type VALUE expression.`
- `TYPES name TYPE type.` and `TYPES: BEGIN OF …, …, END OF ….`
- Structured `DATA: BEGIN OF …, …, END OF ….`
- `TYPE STANDARD TABLE OF type` or `TYPE TABLE OF type`, optionally `WITH EMPTY KEY` or `WITH DEFAULT KEY`.
- `VALUE expression` on classic declarations; `VALUE IS INITIAL` on non-constant declarations.
- Simple `PARAMETERS name TYPE type DEFAULT literal.`

Variables have report-wide names. Repeated declarations, including the same inline name in separate branches, are diagnosed. Use declarations before references. Keep report declarations above event blocks; initialization of declarations inside events is a simplified runtime behavior, not complete SAP declaration semantics.

`"` starts a comment to the end of a line. `*` starts a full-line comment only in column one. Single-quoted text literals and backtick string literals support doubled delimiters (for example, `'It''s'`). String literals cannot span physical lines; string templates can.

## Types and assignment

| Type                            | Implemented behavior                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `i`                             | Integer, initially 0; assignment rounds halves away from zero and checks −2,147,483,648 through 2,147,483,647.                                                      |
| `int8`                          | Integer, initially 0; values outside the exact JavaScript integer range ±9,007,199,254,740,991 are rejected. This is narrower than SAP INT8.                        |
| `string`                        | Variable-length string, initially empty; trailing blanks remain significant.                                                                                        |
| `c LENGTH n`                    | Fixed-length character field, initially spaces; assignments truncate or pad. Default length 1.                                                                      |
| `n LENGTH n`                    | Numeric text, initially zero-filled; assignment retains digits, then truncates/pads from the left. Default length 1.                                                |
| `p LENGTH n DECIMALS d`         | Packed-number-style length and decimal limits, rounding, and overflow checks. Default length 8 and decimals 0. Storage uses JavaScript numbers, not packed decimal. |
| `f`, `decfloat16`, `decfloat34` | Finite JavaScript numbers. Exact decimal arithmetic, SAP precision, and all SAP formatting rules are not implemented.                                               |
| `d`, `t`                        | Digit fields of length 8 and 6, initially `00000000` and `000000`. Assignments truncate/pad; calendar/time validity and arithmetic are not implemented.             |
| `abap_bool`                     | One-character value; `abap_true` is `X`, `abap_false` is a blank.                                                                                                   |

`space` is also predefined. Character length is limited to 65,535; packed length to 16 bytes and decimals to 14, additionally constrained by the declared length.

Supported assignments:

```abap
DATA lv_count TYPE i.
lv_count = 10.
MOVE 12 TO lv_count.
CLEAR lv_count.
FREE lv_count.
```

`CLEAR` and `FREE` accept chains and reset values to their type's initial value. Tables become empty. Structures initialize each component. Structure and table assignment, `APPEND`, and `READ … INTO` copy values; they do not create aliases. Constants and `FINAL` values cannot be mutated through assignments, components, table rows, CLEAR, or FREE.

Character-to-number conversion checks the complete value and rejects invalid text or overflow. Conversion from `c` to `string` drops trailing padding; `string` to `string` preserves it. Structure assignments require matching component names and compatible shapes, rather than implementing all positional SAP structure conversions.

## Expressions and control flow

Expressions support parentheses, unary `+`/`-`, arithmetic `+ - * / DIV MOD`, concatenation `&&`, and these comparisons:

```text
=  <>  >  <  >=  <=
EQ NE  GT LT GE  LE
```

Precedence runs from arithmetic to comparisons, `NOT`, `AND`, and `OR`. Boolean AND/OR short-circuit. `IS INITIAL` and `IS NOT INITIAL` use the operand's type. DIV/MOD use a Euclidean quotient and non-negative remainder. Division by zero and non-finite results raise located runtime errors.

Trailing blanks in `string` comparisons remain significant, including CASE and table keys. Fixed-length character comparisons ignore trailing padding. Numeric/character comparisons use the runtime's numeric conversion rules. SAP's complete comparison-type matrix is outside this release.

Supported blocks:

- `IF … ELSEIF … ELSE … ENDIF.`
- `CASE expression. WHEN value OR value. … WHEN OTHERS. … ENDCASE.`
- `DO expression TIMES. … ENDDO.` and unbounded `DO. … ENDDO.`
- `WHILE condition. … ENDWHILE.`
- `LOOP AT table INTO work_area. … ENDLOOP.` or `INTO DATA(work_area)`.
- `LOOP … WHERE condition` using row components or `table_line` for elementary rows.
- `CHECK condition.`, `CONTINUE.`, `EXIT.`, `RETURN.`

DO evaluates its count once; non-positive counts execute no iterations. CHECK skips the remaining current loop iteration, or returns from execution outside a loop. CONTINUE requires a loop. EXIT leaves the current loop, or returns outside a loop. RETURN stops report execution in this subset. Statement limits count loop iterations even when their bodies are empty.

## Structures, constructors, and internal tables

Structures support nested named types and component access such as `person-name` and `outer-detail-count`. Constructor expressions are real AST nodes:

```abap
DATA(person) = VALUE ty_person( name = 'Alice' age = 30 ).
DATA people TYPE ty_people.
people = VALUE #( ( name = 'Bob' age = 25 ) ).
DATA(number) = CONV i( '0042' ).
```

`VALUE type( )` creates an initial value. Missing structure components are initialized. Elementary tables accept rows such as `( 1 ) ( 2 )`. `#` requires a known contextual type; an untyped inline `DATA(x) = VALUE #( … )` is rejected. `CONV type( expression )` and contextual `CONV #( expression )` perform the supported type conversions.

| Operation   | Supported forms                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Append      | `APPEND value TO table.`                                                                                                       |
| Insert      | `INSERT value INTO TABLE table.`; `INSERT value INTO table INDEX index.`                                                       |
| Read        | `READ TABLE table INTO work_area INDEX index.`; `INTO DATA(work_area)`; `WITH KEY component = value`; `TRANSPORTING NO FIELDS` |
| Loop        | `LOOP AT table INTO work_area [WHERE condition]. … ENDLOOP.`                                                                   |
| Delete      | `DELETE table INDEX index.`                                                                                                    |
| Modify      | `MODIFY table FROM work_area INDEX index.`; index omission inside LOOP AT uses the current `sy-tabix`.                         |
| Sort        | `SORT table [ASCENDING                                                                                                         | DESCENDING].`; `SORT table BY component [ASCENDING | DESCENDING] ….` |
| Size/reset  | `lines( table )`, `CLEAR table.`, `FREE table.`                                                                                |
| Expressions | `table[ index ]`, `table[ component = value ]`, `table[ index ]-component`, and row/component assignment                       |

Indices are positive, one-based integers. Missing rows in table expressions raise an error. READ misses leave an existing target unchanged and set `sy-subrc` to 4. An inline READ target already has its initial value. READ/key expressions can use `table_line` for elementary tables; key operands convert to the corresponding row/component type before matching.

Only standard tables are implemented. EMPTY/DEFAULT KEY syntax is accepted, but there is no persistent key metadata, uniqueness enforcement, sorted lookup, secondary key, or hashed table. SORT without BY sorts scalar rows by value; for structures it uses character-like components. This deliberately simplified behavior does not reproduce every SAP default/empty-key sorting rule. Prefer explicit BY components for structure sorting.

Other additions—ASSIGNING, REFERENCE INTO, field symbols, ranges, binary search, `APPEND LINES OF`, `INITIAL LINE`, DELETE WHERE, and modern iteration constructors—are unsupported.

## Strings and output

```abap
DATA(name) = `Yavuz`.
DATA(text) = |Hello { to_upper( name ) }|.
WRITE / text.

DATA combined TYPE string.
CONCATENATE 'one' 'two' INTO combined SEPARATED BY ','.
DATA: first TYPE string, second TYPE string.
SPLIT combined AT ',' INTO first second.
CONDENSE combined.
```

- String templates support embedded expressions and escapes `\n`, `\r`, `\t`, `\{`, `\}`, `\|`, and `\\`.
- Template formatting additions such as WIDTH, ALIGN, ALPHA, or DATE are unsupported.
- `CONCATENATE … INTO … [SEPARATED BY …]` supports scalar operands.
- `SPLIT … AT … INTO …` supports multiple scalar targets or `INTO TABLE` of string/character rows. The last scalar target receives the remaining text. An empty separator is rejected.
- `CONDENSE variable [NO-GAPS]` trims/collapses spaces or removes them.
- Builtins accept one positional argument: `strlen`, `to_upper`, `to_lower`, `lines`, `abs`, `ceil`, `floor`, `trunc`, `xsdbool`, and `boolc`.
- STRLEN counts trailing blanks in STRING but ignores padding in C. Case conversion follows JavaScript Unicode behavior, not SAP locale services.

WRITE supports a scalar expression, `/` before an item, and colon/comma chains:

```abap
WRITE 'Hello World'.
WRITE / lv_value.
WRITE: / 'Name:', lv_name.
```

Items on the same output line receive separating spaces. `/` begins a new line unless output is empty or already ends with a newline. The first `/` does not create a blank first line. Output has no automatic final newline. This is plain text output, not pixel-perfect SAP classical list rendering; positioning, list events, formatting additions, and locale-specific numeric/date formatting are unsupported.

## Report events and parameters

```abap
REPORT zgreeting.
PARAMETERS p_name TYPE string DEFAULT 'World'.

INITIALIZATION.
  " Optional initialization statements.

START-OF-SELECTION.
  WRITE |Hello { p_name }|.

END-OF-SELECTION.
  WRITE / 'Finished'.
```

For ordinary reports, global classic declarations are initialized first, then INITIALIZATION runs with declared parameter defaults. Supplied dialog values are applied afterward so user input wins before the start event. Unlabelled executable statements belong to the implicit START-OF-SELECTION and execute before an explicit start block. END-OF-SELECTION runs last unless execution has returned or failed. Event sections execute in this order even when their source order differs.

PARAMETERS accepts primitive types, chains, and literal defaults, including negative numeric literals and `abap_true`, `abap_false`, or `space`. The desktop dialog uses the declared default; it does not execute INITIALIZATION to derive dialog defaults. Parameter input is converted to its declared type before the start event. There is no selection-screen emulation, validation event, SELECT-OPTIONS, checkbox/radio-button addition, or obligatory-field addition.

## System fields

| Field      | Behavior in this runtime                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sy-subrc` | Initially 0; successful supported table operations set 0, failed READ/DELETE/MODIFY/INSERT index operations set 4. LOOP sets 0 if any row was processed, otherwise 4. No full SAP operation-specific return-code matrix. |
| `sy-tabix` | Initially 0; READ sets the found index or 0 on a miss; APPEND/INSERT set the inserted index; LOOP sets the current row index. Nested LOOP restores the outer index.                                                      |
| `sy-index` | Current DO/WHILE iteration, starting at 1. Nested loops restore the enclosing value afterward.                                                                                                                           |
| `sy-datum` | Local date at execution-context creation, `YYYYMMDD`.                                                                                                                                                                    |
| `sy-uzeit` | Local time at execution-context creation, `HHMMSS`.                                                                                                                                                                      |
| `sy-uname` | Fixed local sandbox identity `LOCAL`, stored as a padded character field; not an SAP or operating-system login.                                                                                                          |

The date/time fields are captured once per execution. Other SY fields, SAP users, and application-server state are unavailable.

## Checking, formatting, debugging, and limits

Check detects lexical/parser errors, unknown types/variables/components, duplicate declarations/components, unsupported syntax, constant mutations, invalid builtin arity, and type/shape mismatches where statically determinable. Literal conversion problems are often caught during Check; dynamic conversion, overflow, missing rows, division by zero, and execution limits are runtime errors. Diagnostics contain line and column. Semantic checking can collect errors from independent statements; a lexical/parser failure stops that stage at the first error.

The formatter adjusts indentation while preserving literals and comments. It preserves multiline template lines and leaves unfinished lexical input untouched. It is not a complete AST rewriter, keyword normalizer, or SAP pretty printer.

Debug hooks pause before AST statements with detached variable snapshots, including structures, tables, and system fields. Variables may appear with their initial values before their declaration statement executes. Both step commands advance one interpreted statement because procedures and methods are not implemented. Breakpoints on non-statement lines do not move automatically to another line.

The standalone interpreter defaults to 100,000 statement/iteration steps and a 5-second timeout, with an output limit of 8,388,608 UTF-16 code units. Desktop settings provide their own execution limits; the desktop worker additionally limits output to 2 MiB of UTF-8 and applies worker-memory and external active-time safeguards. Debug pauses suspend the desktop deadline. Stop terminates the worker; the next run creates a clean context.

## Deliberate exclusions

This release has no ABAP Objects, procedures/FORMs, exceptions, dynamic programming, references, field symbols, assignment aliases, SAP DDIC, Open SQL/database, RFC/BAPI, SAP connectivity, selection screens, graphical/list processing, transactions, or SAP runtime services.

Advanced expressions such as COND, SWITCH, CORRESPONDING, NEW, REF, REDUCE, FILTER, FOR, LET, and method calls remain roadmap items. Extra additions to otherwise supported statements are not implicitly supported. See [the roadmap](ROADMAP.md) for planned expansion and [architecture](ARCHITECTURE.md) for the extension boundaries.

Automated coverage lives in `tests/language.test.ts`, `tests/language-adversarial.test.ts`, and the paired `.abap` / `.expected.txt` fixtures under `tests/abap/`. Desktop worker tests separately verify execution isolation, stop/restart, debugging, and deadlines.
