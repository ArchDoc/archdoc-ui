# Examples

Each model here shows a part of ArchDoc the others don't, so together they cover the whole platform. Open any of them in the explorer with `archdoc view examples/<file>`. Running from this repository, put `pnpm -s` in front of `archdoc`.

| Example | What it shows | Try |
|---|---|---|
| [quickstart.yaml](./quickstart.yaml) | The least a useful model needs: actors, a system and its containers, a datastore, an external system, data, one rule, and one journey. | `archdoc view examples/quickstart.yaml` |
| [modular-monolith.yaml](./modular-monolith.yaml) | One deployable app taken apart into components. Each one points at its code, down to the snippets that hold its logic. Rules keep the parts apart. Owners, `planned` and `deprecated` parts, and a dependency an agent suggested. | `archdoc show bookstore.checkout`, then `archdoc show bookstore.checkout --code` |
| [event-driven.yaml](./event-driven.yaml) | Pub-sub as topics and events on the publisher, with their transport (Kafka, EventBridge, SQS, MQTT, HTTP, gRPC). There are no broker boxes. One topic fans out to two subscribers, and every arrow points the way the messages go. | Open `reading-to-outage` and step through it |
| [decisions.yaml](./decisions.yaml) | A decision written as CEL rules picks a journey's path. Each outcome writes its own records, and a held purchase continues as another journey. Mappings say field by field how one record becomes another. [authorize-purchase.sample.json](./authorize-purchase.sample.json) runs when the journey opens. | `archdoc simulate authorize-purchase --sample examples/authorize-purchase.sample.json -m examples/decisions.yaml` |
| [big-schema.yaml](./big-schema.yaml) | One database with 24 tables, linked by foreign keys, and a journey whose new rows point at each other and at rows already there. [order-to-cash.sample.json](./order-to-cash.sample.json) seeds it. | Open `order-to-cash`, then switch `erp-db` to Rows |
| [sensitive-data.yaml](./sensitive-data.yaml) | Classified fields (health and personal data), record lifecycles and retention, and rules on where classified data may be stored and where it may never go. | `archdoc show Prescription -m examples/sensitive-data.yaml` |
| [org/](./org) | Several repos that import each other, a landscape with teams and domains, contracts (Protobuf, OpenAPI), and schema files checked for drift. It's the only folder, because federation needs separate repos. | `pnpm playground --open` (see [org/README.md](./org/README.md)) |

## Seeing a change

Three variants of the quickstart show what a pull request's reviewer sees. Compare any variant with the quickstart: `diff` lists the model changes, `report` writes the PR comment, and `view --base` shows the change on the canvas.

| Variant | The change | Try |
|---|---|---|
| [quickstart.add-reviews.yaml](./quickstart.add-reviews.yaml) | Adds a service, its store, a data entry, and a journey. | `archdoc diff examples/quickstart.yaml examples/quickstart.add-reviews.yaml` |
| [quickstart.pii-to-analytics.yaml](./quickstart.pii-to-analytics.yaml) | Sends shoppers' emails to an outside analytics tool, which the shop's own rule forbids. | `archdoc report --base examples/quickstart.yaml -m examples/quickstart.pii-to-analytics.yaml` |
| [quickstart.drop-payments.yaml](./quickstart.drop-payments.yaml) | Removes a relationship that the critical checkout journey still walks. The report names the journey, and `validate` fails. | `archdoc view examples/quickstart.drop-payments.yaml --base examples/quickstart.yaml` |

## Samples

A journey runs when it opens, on a sample named after it: `<journey>.sample.json` next to the model, or any JSON file in a `samples/` folder. Without one, it runs on example data made up from each field's name and type.
