---
"@archdoc/core": minor
"@archdoc/analyzers": minor
"@archdoc/cli": minor
"@archdoc/mcp": minor
---

Agents close the loop, and reviewers see the change. `@archdoc/mcp` adds `archdoc_check`, `archdoc_diff`, and `archdoc_propose`, its first write tool: it adds elements and relationships to the model as suggestions with a rationale note in `.archdoc/proposals/`, never changes or removes what's there, keeps the YAML's formatting, and writes nothing that wouldn't validate. `@archdoc/core` adds `propose`, `planProposal`, `insertIntoMap`, and `readModelSourcesAtRef`. `@archdoc/analyzers` adds `checkRepository`, shared by the CLI and MCP. `archdoc view --base <ref>` shows the explorer's before/after view: changed boxes and relationships, removed ones as ghosts, suggested facts dashed, and affected journeys flagged.
