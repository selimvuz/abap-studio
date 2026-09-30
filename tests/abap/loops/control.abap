DATA(total) = 0.
DO 5 TIMES.
  CHECK sy-index MOD 2 = 1.
  total = total + sy-index.
ENDDO.
WHILE total < 12.
  total = total + 1.
ENDWHILE.
WRITE total.
