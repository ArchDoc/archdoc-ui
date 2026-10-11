---
"@archdoc/spec": minor
"@archdoc/core": minor
"@archdoc/cli": minor
---

Mappings, logic, lineage, and simulation. `mappings:` say how records become other records, field by field, as CEL expressions over named inputs, written to an entry or a datastore table. `logic:` blocks are an element's decisions on the data it receives, as CEL rules (first match wins, then `else`). Journey steps `decide` with a logic block and say what each outcome's `branches` create, change, or continue as; later steps run `when` an outcome was decided, and write `via` a mapping. `validate` checks inputs, targets, and fields, that expressions parse, that rules end with `else`, and that branches, `when`, and `via` name something real, in this repo and in synced imports. `archdoc lineage <Entry.field>` follows a value through every mapping across repos to the tables it lands in. `archdoc simulate <journey> --sample <file>` runs a journey against sample records: the branch each decision takes and why, the records each step creates and changes, and where they're stored, deterministically. The PR report shows changed mappings and decisions with their expressions before and after. The landscape composes every repo's mappings and logic. CEL runs on `@marcbachmann/cel-js`.
