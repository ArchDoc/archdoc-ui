---
"@archdoc/spec": minor
"@archdoc/core": minor
"@archdoc/cli": minor
"@archdoc/mcp": minor
---

Add bug traces: the path one failing request took, written to `.archdoc/traces/<id>.yaml` and attached to the journey step where the error showed up (`expands: <journey>#<step>`). Steps use journey step syntax plus `role` (ok, cause, spreads, symptom), `evidence` (reproduced, read, inferred), `observed`/`expected`, and `missing`; a trace also has `works-in` and `fix`. Traces are never loaded into the model.

- spec: `TraceFileSchema`, also in the JSON Schema.
- core: `parseTrace`/`loadTraces`, `checkTrace` (unknown elements, journeys, and steps, stale code references, hops the model doesn't declare, a missing cause) with a resolved view for drawing, `anchorError` (stack frames and paths in JavaScript, Python, Go, Rust, and Java, mapped to elements and ranked journey steps), `traceSkeleton`, `tracesInChange` for the PR comment, `readTraceSources`, and text renderers.
- cli: `archdoc trace anchor|check|list|show`; `archdoc show` finds traces too.
- mcp: `archdoc_anchor` and `archdoc_trace_check`.
