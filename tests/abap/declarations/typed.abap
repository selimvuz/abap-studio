REPORT ztyped.
TYPES ty_count TYPE i.
CONSTANTS c_limit TYPE ty_count VALUE 3.
DATA: lv_text TYPE c LENGTH 4 VALUE 'Hello',
      lv_number TYPE n LENGTH 4 VALUE '27',
      lv_amount TYPE p LENGTH 5 DECIMALS 2 VALUE '12.345'.
WRITE: / lv_text, lv_number, lv_amount, c_limit.
CLEAR lv_text.
IF lv_text IS INITIAL.
  WRITE / 'cleared'.
ENDIF.
