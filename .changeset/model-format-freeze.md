---
"@archdoc/spec": minor
"@archdoc/core": minor
"@archdoc/cli": minor
---

The model format is split into stable and experimental parts. `imports`, `landscape`, `domains`, rules with `scope: org`, `mappings`, `logic`, and journey steps' `decides` and `branches` are experimental: their JSON Schema descriptions start "Experimental", and `archdoc validate` (and its `--json`) names the ones a model uses in a note that doesn't fail `--strict`. Core's `experimentalUses(model)` lists them. The JSON Schema is at https://cdn.jsdelivr.net/npm/@archdoc/spec@0/schema/archdoc.v2.schema.json for editors.
