---
"@archdoc/core": patch
---

Reading a model at a git ref works through symlinked paths, such as macOS's temporary directory. `archdoc sync` no longer fails with "No ArchDoc model at .archdoc" on macOS, and `diff`, `check`, and `report --base` work in a checkout reached through a symlink.
