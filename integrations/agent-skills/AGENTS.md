<!-- Paste this near the top of your repository's AGENTS.md (read by Codex, Cursor, Copilot, and others). -->

## Architecture model (ArchDoc): start here

This repository's architecture is modeled in `.archdoc/`: actors (who uses the system), elements (what it's made of, each mapped to code paths), journeys (how actors reach their goals), and data. People own the model. It's the fastest way to find where code lives and what a change affects, so use it before you search the code.

Every task: context, edit, check, seal. Each MCP tool has a CLI command of the same name.

1. Find where to start, before grepping: the `archdoc_context` MCP tool with the task in a few words, the files you plan to change, or both (for example "pr report shows type undefined for data fields"), or `archdoc context <words or paths>`. It returns the files and functions to open first, other code that does the same job (other callers of the functions they use, which a fix usually needs too), the data, rules, and journeys involved, the tests to run, owners, and who uses it, other repos included.
2. Name the affected journeys and actors when you share your plan. Ask the user before changing a critical journey, or removing or renaming anything another repo uses.
3. Look up any one thing with `archdoc_show` (or `archdoc show <id>`): an element (with its code), actor, journey (with a sample, it runs the journey), data entry, `Entry.field` (its lineage), trace, or a fact `archdoc_check` names.
4. Edit the model with the code. Add a component or a dependency you meant to add, marked `provenance: { source: suggested, by: agent:<your-name> }`; update `.archdoc/` in the same change if you moved or removed one; update `data:` and the `sends`, `accepts`, `returns`, or `stores` that name it if a component's data changes, and classify sensitive fields (`classification: pii`). Elements in other repos are referenced by namespace (`payments.charges`); to depend on a new repo, add it to `imports` in `archdoc.yaml` and run `archdoc sync`. Never edit `.archdoc/archdoc.lock` or `.archdoc/vendor/` by hand.
5. Check: `archdoc_check` with base "main", or `archdoc check --base main`. It gives the verdict the PR comment will give, and what your change introduced, each with its fix: imports the model doesn't declare, broken rules and journeys, stale paths, data rules, traces, and facts whose code changed since they were sealed. Fix those; if a new dependency isn't intended, remove the import.
6. Seal: for each fact whose code changed, read what changed, update the model if it no longer describes the code, then seal it with `archdoc_seal` or `archdoc seal <fact> --by agent:<your-name>`. It says what's still to check. Never seal a fact you haven't read: reviewers see what you sealed in the PR.

In the PR description, list the affected journeys and actors and the model changes you suggested. `archdoc report --base main` (or `archdoc_check` with `format: "markdown"`) writes this for you.

When you're asked to explain or fix a bug (a log line, a stack trace, wrong output):

1. Place the error: `archdoc_context` with `error` set to the text, or `archdoc context --error log.txt` (or `-` for stdin). It ranks the journey steps the error most likely showed up in, names the elements its frames and paths map to, and suggests a trace to start from.
2. Follow the code from there, and write the path the failing request actually took to `.archdoc/traces/<id>.yaml`: `expands: <journey>#<step>`, one step per hop with `role` (cause, spreads, symptom) and `evidence` on every step (`reproduced` if you saw it run, `read` if you followed it in the code, `inferred` otherwise), `observed`/`expected` values where they differ, and `missing` for a call that didn't happen. A trace is evidence of one run, not the design: it's never part of the model.
3. `archdoc_check` checks it: fix unknown elements and stale code references. A hop the model doesn't declare is drift you found while debugging, so mention it.
4. Commit the trace with the fix, so the PR says which bug it fixes.

In a repository with no `.archdoc/` yet, `archdoc_init` (or `archdoc init`) starts a model from its packages, compose services, imports, and schema files, every fact marked inferred. Then describe each element with the code open, add actors and the two or three journeys that matter most, run `archdoc_check` until it's clean, and ask a person to review it.
