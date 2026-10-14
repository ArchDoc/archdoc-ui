---
"@archdoc/cli": minor
---

A journey folds the parts of a big database it doesn't use. In the schema (ERD), the tables a journey doesn't write or read fold into one box listing them; in Rows, a table shows only the rows the journey creates, changes, or reads, plus the rows they point at, and says how many it hides. Click a folded table to bring it back, or tick "All tables" in the journey bar. Tables of rows are laid out within their datastore, placed to keep the lines between rows short, and reordered to keep them from crossing: the ERP example's order-to-cash goes from over a hundred crossings to under ten, and no line loops around the datastore's edge. Each column of a table of rows is as wide as its header and values need, up to a limit, and the table is wide enough for its title.
