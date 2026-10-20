---
"@archdoc/cli": minor
"@archdoc/core": minor
---

The explorer's Changes tab reads a branch the way it reads the working tree: with its imported schemas, the other repos its lockfile pins, its sample data, and code links to its commit, so a branch no longer shows warnings the working tree doesn't. Core adds `listFilesAtRef` and `readFileAtRef`, and `readFederationInput` takes a reader for files that aren't on disk. Journey steps can open the data they send from one element to another, or the records they write: every value, with sensitive fields marked, or as JSON to copy. Example data now includes the messages a step's arrow sends, not only what the step itself sends.
