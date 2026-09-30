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
