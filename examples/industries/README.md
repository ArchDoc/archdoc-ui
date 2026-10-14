# Industry examples

Hypothetical systems from seven industries, each one model file that uses the whole spec: journeys whose every step carries a message, data with classifications, foreign keys, and lifecycles, decisions (`logic`), `mappings`, and relationship and data rules. Each validates with no warnings, keeps its own rules, and is run by the tests (`packages/core/test/industries.test.ts`), which simulate each decision against sample data.

| File | System | What it shows |
|---|---|---|
| [healthcare.yaml](./healthcare.yaml) | A telehealth clinic | Health information (`phi`) only stored where HIPAA applies and kept from reporting; a triage decision; a prescription lifecycle sent to a pharmacy network |
| [banking.yaml](./banking.yaml) | A card issuer | Card numbers (`pci`) only in a tokenization vault and never sent to the fraud model; an authorization decision with four outcomes; holds in a ledger |
| [ecommerce.yaml](./ecommerce.yaml) | An online store | A cart that becomes an order through a mapping; an order lifecycle; order events a warehouse subscribes to; only checkout may call the payment provider; a planned service |
| [logistics.yaml](./logistics.yaml) | A parcel network | Scanner events through a queue; a partner carrier calling in; a delivery-exception decision; a public tracking page that never shows contact details |
| [insurance.yaml](./insurance.yaml) | Motor claims | A decision with several inputs that hands off to an adjuster's journey (`next`); a payout less the excess; bank details kept from analytics |
| [energy.yaml](./energy.yaml) | An electricity utility | Smart-meter telemetry; an outage decision; a bill computed by a mapping; 15-minute readings treated as personal data; a deprecated system |
| [erp.yaml](./erp.yaml) | A wholesale ERP | A big schema: 24 tables in one database, linked by foreign keys, and an order-to-cash journey that creates rows pointing at each other and at the rows already there. [samples/order-to-cash.json](./samples/order-to-cash.json) seeds the database with several rows per table |

Open one in the explorer:

```sh
pnpm build
node packages/cli/dist/bin.js view examples/industries/banking.yaml --open
```

Then pick a journey and step through it, open a datastore's tables, or click a field to follow its lineage.

For the ERP, open `order-to-cash`: the sample named after the journey runs on its own. The journey bar lists the database; switch it from ERD (its tables, keys and foreign keys only, since it has so many) to Rows to watch records appear step by step, each linked to the rows it points at. The rows the current step writes light up, with the rows they point at, and the camera follows them. Of the 24 tables, the ten the journey writes or reads stay open and the rest fold into one box; in Rows, a table shows only the rows the journey touches and the rows they point at, and says how many it hides. Click a folded table to bring it back, or tick "All tables" to see everything. `archdoc show authorize-purchase -m examples/industries/banking.yaml` prints a journey with each step's message.
