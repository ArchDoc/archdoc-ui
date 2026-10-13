---
"@archdoc/spec": minor
"@archdoc/core": minor
"@archdoc/analyzers": minor
"@archdoc/cli": minor
---

Data on the system canvas. A data field can point at another entry's field with `references: Charge.id` (or `Charge`, for its key); a field whose type names another entry points at it too, and SQL migrations and Prisma schemas fill references in from their foreign keys and relations. `validate` reports references that don't resolve, and the landscape keeps them pointing at the right entries. In the explorer, picking a message lights up the arrows it travels along and animates them; picking an entity opens the datastore that stores it into its tables, with a line for each foreign key, and any datastore's tables open from its card. A field's lineage now lights up on the same canvas, in every table and along every arrow on the way, instead of replacing it with a separate graph. `archdoc view` reads schema sources, so the explorer shows the types and foreign keys `check` sees.
