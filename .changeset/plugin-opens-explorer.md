---
"@archdoc/cli": patch
---

The Claude Code plugin opens the explorer for you. Asked to see the architecture, or after creating or changing the model, the skill starts `archdoc view --watch --open` in the background and reports its URL, reusing one already running, and on a remote machine (a cloud session or SSH) writes `archdoc site` instead and says where. `/archdoc:view [path] [--base <ref>]` does the same on demand.
