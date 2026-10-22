---
"@archdoc/analyzers": minor
"@archdoc/core": patch
---

Python and Go analysis. `check` finds imports between elements the model doesn't declare in Python and Go code, the way it does for TS/JS: Python imports resolve through project roots (`src/`, each `pyproject.toml`), packages, and relative imports; Go imports through every `go.mod`, with `replace` lines and `go.work`. The code index covers both, so `context` ranks their files and functions and seals fingerprint their exports. `init` adds uses from those imports, splits a flat Go module or Python project by its packages, and skips a `pyproject.toml` that only declares a workspace. Core counts `_test.go`, `test_*.py`, and `*_test.py` as tests.
