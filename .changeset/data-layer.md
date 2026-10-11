---
"@archdoc/spec": minor
"@archdoc/core": minor
"@archdoc/cli": minor
---

Data, part one. Data entries (`entity`, `message`, `event`) have fields with a `classification`, enum `values`, and lifecycle `states`. Datastores map tables to entries with `stores`, relationships `send` data, contracts `accept`, `return`, or `carry` it, and journey steps say what they `send`, `create`, and `change`. Data in other repos is referenced by namespace and checked once synced. `validate` reports undefined data, unknown fields, values outside an enum, state changes the lifecycle doesn't allow, and data sent to an element that doesn't accept it. A new rule kind, `data: { classification, stored-in | not-sent-to }`, runs in `check` (and as an org rule from the landscape). Rule selectors can now name elements in other repos (`payments.charges`) and match `{ namespace }`. The PR report gains a Data section: entries that changed, and sensitive data a change sends or stores somewhere new, with external elements called out. `archdoc show` and `search` cover data entries, and `archdoc landscape build` composes every repo's data. `@archdoc/core` exports `resolveData`, `dataFlows`, `dataStores`, `checkData`, `evaluateDataRules`, and `sensitiveDataChanges`.
