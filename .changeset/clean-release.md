---
"@archdoc/spec": patch
"@archdoc/core": patch
"@archdoc/analyzers": patch
"@archdoc/federation": patch
"@archdoc/mcp": patch
"@archdoc/cli": patch
---

Packages are built from clean before they're released, so they no longer ship leftover files from removed sources (0.1.0's CLI included an unused `dist/commands/data.js`). Each package now publishes as public by default.
