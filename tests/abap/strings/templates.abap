DATA(name) = `Yavuz`.
DATA(text) = |Hello { to_upper( name ) }|.
WRITE / text.
DATA combined TYPE string.
CONCATENATE 'one' 'two' INTO combined SEPARATED BY ','.
DATA: first TYPE string, second TYPE string.
SPLIT combined AT ',' INTO first second.
WRITE: / first, second, strlen( name ).
