---
"@archdoc/core": minor
"@archdoc/cli": minor
"@archdoc/mcp": patch
---

Every arrow on a journey carries a message. A step without `sends:` carries what the relationship it travels along sends (between its boxes, their parents, or what's inside them, and in another repo's model for a step that starts there), what the API it calls accepts (or returns, for a lookup), or what it writes through a mapping or creates and changes. `validate` warns about a step none of these name (`journey/step-without-message`), once the repos it goes into are synced, and `archdoc show <journey>` and the `archdoc_journey` MCP tool print each step's message and where it comes from. In the explorer, the current step's message travels along its arrow; opening a journey opens the tables it writes to, and each step lights up the row it adds or the fields it changes, with their values when the journey is simulated. The details panel expands each step to its message's fields.
