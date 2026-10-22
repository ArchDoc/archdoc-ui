---
"@archdoc/cli": minor
"@archdoc/mcp": minor
"@archdoc/analyzers": minor
---

Simulation is hidden, and sharing models across repos is experimental. `show <journey> --sample`, the `sample` input of `archdoc_show`, and the explorer's "Try a sample" are gone, and the explorer no longer runs journeys: steps show their messages' fields, and a journey's rows are what its steps declare. `archdoc view` and `archdoc site` stop sending sample files. `simulate()` stays in `@archdoc/core`. `sync`, `publish`, `landscape build`, and `view --landscape` still work but are left out of `--help`, which now ends with a note pointing to docs/experimental.md.
