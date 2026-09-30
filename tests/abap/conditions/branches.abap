DATA(lv_value) = 10.
IF NOT lv_value < 5 AND lv_value LE 10.
  WRITE 'in range'.
ELSEIF lv_value > 10.
  WRITE 'large'.
ELSE.
  WRITE 'small'.
ENDIF.
CASE lv_value.
  WHEN 1 OR 10.
    WRITE / 'matched'.
  WHEN OTHERS.
    WRITE / 'other'.
ENDCASE.
