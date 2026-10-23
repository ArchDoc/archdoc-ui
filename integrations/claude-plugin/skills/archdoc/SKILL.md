---
name: archdoc
description: Use at the start of every coding task in a repository that has an .archdoc/ directory, before searching or reading code. Finds where the change belongs in the architecture model and what it affects (consumers, actors, journeys, owners, rules). Also use after editing, to check the change and keep the model true; when asked to explain or fix a bug, to place the error and write a trace; and in a repository with no .archdoc/ yet, to start a model with archdoc init.
---

# Working in a repository with an ArchDoc model

`.archdoc/` holds the architecture the team agreed on: who uses the system (actors), what it's made of (elements, each mapped to code paths), how people use it (journeys), and the data it sends and stores. People own it. It's the fastest way to find where code lives and what a change affects, so start with it, before you grep.

Five MCP tools, one per question. Use them, not the CLI.

The ArchDoc MCP server starts with the session through `npx`, which takes a few seconds the first time, so its tools may not be in your tool list yet, or may be listed by name only (`mcp__plugin_archdoc_archdoc__archdoc_context` and the like). If you don't see them, search your tools for "archdoc" and load them, and if the server is still starting, wait and search again. Run the CLI instead only when no ArchDoc MCP server is configured at all; each command prints the same answer as its tool.

| Tool | Question | CLI, only without the MCP server |
|---|---|---|
| `archdoc_context` | Where do I start, and what does it affect? | `archdoc context <words or paths>`, `--error <file>` |
| `archdoc_show` | What is this one thing? | `archdoc show <id>` |
| `archdoc_check` | What's wrong or stale, and what does my change do? | `archdoc check --base main` |
| `archdoc_seal` | I checked these facts against their code. | `archdoc seal <fact> --by agent:<name>` |
| `archdoc_init` | There's no model yet. | `archdoc init` |

## A change: context, edit, check, seal

1. **Find where to start.** Call `archdoc_context` with the task in a few words, the files you plan to change, or both, such as `pr report shows type undefined for data fields`. You get the files and functions to open first (with line numbers), other code that does the same job (a fix in one place usually needs them too), the data and rules involved, the narrowest journeys, the tests to run, owners, and who uses it, other repos included. Read those files before you grep. A path you're about to create works too: it says where the file belongs.
2. **Say what it affects.** Name the affected journeys and actors when you share your plan. Ask the user first if a critical journey is involved, if the change would break a rule, or if it removes or renames something another repo uses.
3. **Look things up as you go.** `archdoc_show` takes any ID: an element (`code: true` adds its snippets' text), an actor, a journey, a data entry, `Entry.field` (where its value comes from and goes), a trace, or a fact `archdoc_check` names.
4. **Edit the code and the model together.** Stay inside the element boundaries you found. When the change adds a component or a dependency between elements on purpose, add it to `.archdoc/` and mark it as a suggestion, so a person accepts it:

   ```yaml
   uses:
     billing:
       description: Sends invoice events
       provenance: { source: suggested, by: agent:claude-code }
   ```

   When you remove, rename, or move something, update `.archdoc/` in the same change. When a component sends, accepts, or stores different data, update `data:` and the `sends`, `accepts`, `returns`, or `stores` that name it, and classify sensitive fields (`classification: pii`). Elements in other repos are referenced by namespace (`payments.charges`); to depend on a new repo, add it to `imports` and run `archdoc sync`. Never edit `.archdoc/archdoc.lock` or `.archdoc/vendor/` by hand.
5. **Check.** Call `archdoc_check` with base `main` (or the branch you started from). It leads with the verdict the PR comment will give, then what blocks the merge and what to check, each with its fix: imports the model doesn't declare, broken rules and journeys, stale paths, data rules, and facts whose code changed since they were sealed. Fix what your change introduced; if a dependency isn't intended, remove the import. Check again until it's clean.
6. **Seal what you checked.** If the repository keeps `.archdoc/archdoc.sum`, `archdoc_check` names each fact whose code you changed and what changed. Read it, update the model where it no longer describes the code, then call `archdoc_seal` with those facts (an element ID seals all of its facts) and `by: agent:<your-name>`. It says what's still to check. Sealing is your word that the model is right, and reviewers see it in the PR, so never seal a fact you haven't read.

In the PR description, list the affected journeys and actors and the model changes you suggested: `archdoc_check` with `format: "markdown"` (or `archdoc report --base main`) writes it for you.

## A bug: context on the error, then a trace

1. **Place the error.** Call `archdoc_context` with `error` set to the error as the user gave it: a log line, a stack trace, or the wrong output (CLI: `archdoc context --error log.txt`, or `-` for stdin). You get the journey steps it most likely showed up in (best first, with why), the elements its stack frames and paths map to, and a trace to start from.
2. **Follow the code** from the top step, and write the path the failing request actually took to `.archdoc/traces/<id>.yaml`:

```yaml
trace: refund-waits-for-finance
title: A $4 refund waits for finance instead of going through
symptom: |
  refund ref-ch-81: status pending_approval (expected approved)
reproduce: 'POST /refunds { "charge_id": "ch-81", "amount": 4.00 }'
expands: request-refund#4          # the journey step where it showed up (1-based)
diagnosis: The gateway converts the amount to cents a second time.
steps:
  - { from: app, to: api-gateway, action: Sends the refund request, evidence: read }
  - from: api-gateway
    to: payments.charges
    action: Forwards the request, multiplying the amount by 100
    code: services/gateway/src/refunds.ts:42
    role: cause                    # ok (default), cause, spreads, symptom
    evidence: reproduced           # reproduced, read, or inferred (default)
    observed: { RefundRequest.amount_cents: 40000 }
    expected: { RefundRequest.amount_cents: 400 }
fix: Pass amount_cents through unchanged.
```

   Give every step evidence, and be honest about it: `reproduced` only for what you saw run, `read` for what you followed in the code, `inferred` for the rest. `missing: { to, call }` marks a call that should have happened and didn't, and `works-in: { element, code, note }` points at code that does the same job right. A trace is evidence of one run, not the design, so it's never part of the model.
3. **Check it** with `archdoc_check`, which checks traces too: unknown elements and journeys, and stale code references. A hop the model doesn't declare is drift you found while debugging: say so, and add it to the model if the code is right. `archdoc_show` with the trace's ID shows it as the explorer will.
4. **Commit the trace with the fix.** The PR comment then says which bug the change fixes.

## No model yet: init, then make it true

In a repository with no `.archdoc/`, when the user asks you to model it (or to use ArchDoc):

What `init` writes is a starting point, not a model: it knows the packages and their imports, not what they're for or who uses them. Steps 2 to 4 are the work, and they're done before you hand the model over, even when `archdoc_check` already passes.

1. **Start it.** Call `archdoc_init` (or run `archdoc init`). It writes `.archdoc/` from what the repository declares: a container per package, module, or code directory, datastores and queues from compose files, uses from imports, and data and contracts from schema files. Everything is marked `provenance: { source: inferred }`. It never writes over a model.
2. **Describe each element** with the code open (`archdoc_show <id>` with `code: true`): what it does, not what it's called. Merge or split elements where the packages don't match how the system works; a component can point at the function its logic lives in (`code: { path, symbol }`).
3. **Add actors**: who and what uses the system. Look for routes, CLIs, UIs, scheduled jobs, webhooks, and other services calling in.
4. **Add the two or three journeys that matter most**, with `code:` on each step, so `archdoc_context` can point at them.
5. **Check** with `archdoc_check` until it has no errors. Fix a warning only with what the code shows: an element nothing connects to is fine to leave or remove (build tooling often is), and a step that doesn't say what it sends can wait for `data:`. Never add a use or step you haven't seen in the code to quiet a warning; say what's left instead. Then ask the user to review the model in `archdoc view`. They accept facts by removing their `provenance` blocks. Once they have, `archdoc seal --all` starts keeping the model true.
