---
"@archdoc/mcp": minor
"@archdoc/cli": minor
---

Data in the explorer and for agents. The MCP server adds `archdoc_data` (an entry's fields, classifications, lifecycle, where it's stored and sent), `archdoc_lineage` (where a field's value comes from and goes, across repos), and `archdoc_simulate` (the branch a journey takes for a sample request, and the records it writes), and tells agents to use them before changing data. The explorer gains a Data section: pick an entry to see its fields and classifications and light up where it's stored and the relationships it travels along; click a field to draw its lineage graph across repos. Journeys that carry data get a simulator: edit a sample (or pick one from the repo's `samples/*.json`), run it in the browser, and read the branch each decision takes and the records each step creates and changes, in a timeline and in the journey bar. `archdoc view` now sends other repos' vendored models, so the explorer checks and simulates across repos like the CLI.
