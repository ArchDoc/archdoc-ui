---
"@archdoc/cli": minor
---

The explorer shows traces. A Traces tab, there when the model has traces, opens each one with the log the agent was given and how to reproduce it, beside the diagnosis with the journey step it opens up, whether it was reproduced, and how many hops the model doesn't declare. The failing run is drawn as lanes beneath the modeled step: the cause in red, where it spreads in amber, the step that matches the log, undeclared hops and missing calls dashed, and where the same job works in green. The panel shows the selected hop's code, what was observed and expected, its evidence, and what `checkTrace` found. `archdoc view` sends the trace files, and the explorer checks them in the browser. The Overview's map also opens from its left edge when it's too wide to fit at a readable zoom.
