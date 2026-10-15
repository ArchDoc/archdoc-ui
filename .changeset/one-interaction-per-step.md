---
"@archdoc/core": minor
"@archdoc/cli": minor
---

Each journey step is one interaction. `validate` warns about a step that also writes into a datastore it doesn't go to (`journey/step-writes-elsewhere`), naming who should store it there as a step of its own, and `stepStores` in core says which datastores those are. The explorer plays such a step as two interactions, the message and then the storing ("2" and "2.1"), so the camera follows the message before the rows. The industry examples are written that way.

In the explorer, tables show their name and field count until opened, and a field's lineage opens the tables it goes through. A journey without a sample named after it runs on example data made up from each field's name and type, with keys and the fields that name them agreeing, so rows show values rather than a mapping's expressions; the simulator offers "Example data" next to the repo's samples. The journey card leads with what the current step does, then who it goes between and what it carries, with a progress strip, and keeps the datastore controls and which data it runs on in a footer.
