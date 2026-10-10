---
"@archdoc/core": minor
"@archdoc/cli": minor
---

The pull request report now leads with Mermaid diagrams, which GitHub renders in comments and PR descriptions: a flowchart of the change (elements and relationships added, changed, or removed, suggested facts dotted, unchanged neighbors in grey, parts drawn on their container) and a sequence diagram of each of the three most important affected journeys, with the affected steps highlighted and added and removed steps marked. `@archdoc/core` exports `changeDiagram` and `journeyDiagram`; `prReport` takes `diagrams` and `maxJourneyDiagrams`. `archdoc report` takes `--no-diagrams`.
