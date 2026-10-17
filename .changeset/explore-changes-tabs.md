---
"@archdoc/cli": minor
"@archdoc/core": minor
---

The explorer has Explore and Changes tabs. Changes compares the model on any two branches, or a branch and the working tree, and lists what breaks, the journeys affected, elements and arrows, data, and suggested facts, in that order; click one to go to it. `archdoc view` serves the branches at `/api/refs` and the model at two of them at `/api/compare`, and core adds `listBranches`. The change count no longer counts data entries that only the working tree's imported schemas filled in.
