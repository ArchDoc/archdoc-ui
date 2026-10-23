---
"@archdoc/core": patch
---

`check --base`, `report`, and the explorer's branch compare no longer fail with "Can't read <file>" when a change renames a file without changing it. Changed files now list a renamed file under both names, so the base reads the old one from git.
