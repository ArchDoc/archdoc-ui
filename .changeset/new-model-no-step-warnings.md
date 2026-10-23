---
"@archdoc/core": patch
---

A model that describes no data yet no longer gets a warning per journey step that doesn't say what it sends: there's nothing it could send. It gets one info note instead, which `validate` prints and the explorer, `check`, and the PR comment leave out. Before, every new model opened in `archdoc view` on a list of these warnings. Once the model has `data:` entries, each such step is a warning again.
