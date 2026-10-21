---
"@archdoc/cli": minor
"@archdoc/core": patch
---

The CLI drops the commands that other commands replaced, since none of them was ever released: `search`, `locate`, and `impact` are `context <words or paths>`; `lineage` and `simulate` are `show <Entry.field>` and `show <journey> --sample <file>`; `verify` is `check --seals`; `trace anchor`, `trace check`, and `trace show` are `context --error`, `check`, and `show <trace>`. `eval` and `migrate` still work but leave `--help`. `context --error` now says `--format json` doesn't apply instead of printing text, and messages and the suggested trace no longer name the removed commands.
