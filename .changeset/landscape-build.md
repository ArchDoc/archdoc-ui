---
"@archdoc/spec": minor
"@archdoc/core": minor
"@archdoc/cli": minor
---

The landscape repo. `archdoc landscape build` composes the landscape's model with every model it imports into one (each repo a system named by its namespace, its elements inside, references and journeys connected across repos, repo copies of landscape teams merged), checks it (journeys across repos, owners that resolve to no actor are errors, the landscape's rules across repos), and writes the explorer and the composed model as a static site for GitHub Pages. `archdoc view --landscape` serves it live, and the explorer now uses relative URLs so it runs from any path. The spec adds `domains:` and `scope: org` on rules: in a repo that imports the landscape, owners resolve against the landscape's teams and its org rules run in `check`. `@archdoc/core` exports `composeLandscape`. `integrations/landscape-template` is a starting point for a landscape repo.
