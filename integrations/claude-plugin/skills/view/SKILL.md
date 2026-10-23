---
name: view
description: Open the ArchDoc explorer on this repository's architecture model, in the user's browser, without a second terminal. Optionally a model path or --base <ref> to open on a change.
argument-hint: "[path] [--base <ref>]"
disable-model-invocation: true
---

# Open the ArchDoc explorer

Open the explorer on this repository's model (`.archdoc/`) for the user. Arguments: $ARGUMENTS (optional: a model path, `--base <ref>`, or both).

1. **Already running?** If you started the explorer earlier in this session with the same arguments and it's still running, give its URL again instead of starting another.
2. **On a remote machine?** If `CLAUDE_CODE_REMOTE` is `true`, or `SSH_CONNECTION` or `SSH_TTY` is set, `127.0.0.1` isn't the user's machine. Write the explorer as a static site instead: `npx -y @archdoc/cli site --out archdoc-site $ARGUMENTS`. Tell the user where it is: a folder of HTML they can open or host, not for committing.
3. **Otherwise, start it in the background**, so it doesn't block the session (in Claude Code, the Bash tool's background option, not a trailing `&`): `npx -y @archdoc/cli view --watch --open $ARGUMENTS`. `--open` opens the user's browser, and `--watch` updates the page as the model changes.
4. **Report the URL** from the line it prints, `ArchDoc explorer: http://127.0.0.1:<port>`, reading the background output for it. With `--base`, add `#changes` so the link opens on the change.

If it says there's no model (`No ArchDoc model at …`), tell the user and offer to start one with the `archdoc` skill. If `npx` fails, say what it printed.
