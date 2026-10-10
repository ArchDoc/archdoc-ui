---
"@archdoc/spec": minor
"@archdoc/core": minor
"@archdoc/federation": minor
"@archdoc/mcp": patch
---

Cross-repo impact. A repo can import the landscape with `landscape:` in `archdoc.yaml`; `archdoc sync` reads it at its release tag with every model it vendors (checked against its lock), so one fetch brings every repo's model. `impact`, `show`, and the MCP tools then list consumers and journeys in other repos, and `show payments.charges` works for elements in other repos. The pull request report lists consumers in other repos, marks the ones a change breaks (an element they use is removed, or a contract they use `via`) or deprecates, adds their journeys and actors with sequence diagrams, and draws them in the change diagram. Model diffs name the contracts that changed. The spec adds `landscape:`, `lock.landscape`, and `includes` on bundles.
