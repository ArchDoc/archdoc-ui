---
"@archdoc/core": minor
"@archdoc/cli": minor
---

During a journey, a datastore it writes to switches between its schema (ERD) and its rows, from the datastore's card or the journey bar. Rows are the ones the sample starts with plus every record the journey creates or changes up to the current step, grouped by table, each linked to the rows its foreign keys name; the current step's rows light up and the camera follows them. A sample can give a list of rows for an entry (the first is the one logic and mappings read), and a sample named after the journey (`samples/<journey>.json`) runs when the journey opens. A datastore with many tables shows compact tables (keys, foreign keys, and sensitive fields), and selecting one lights up the tables it's linked to. A mapping that writes a record with a different key from the one there creates a new record instead of overwriting it, and a step's message narrows to the entries it writes.
