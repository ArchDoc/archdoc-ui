# Industry examples

Hypothetical systems from six industries, each one model file that uses the whole spec: journeys whose every step carries a message, data with classifications, foreign keys, and lifecycles, decisions (`logic`), `mappings`, and relationship and data rules. Each validates with no warnings, keeps its own rules, and is run by the tests (`packages/core/test/industries.test.ts`), which simulate each decision against sample data.

| File | System | What it shows |
|---|---|---|
| [healthcare.yaml](./healthcare.yaml) | A telehealth clinic | Health information (`phi`) only stored where HIPAA applies and kept from reporting; a triage decision; a prescription lifecycle sent to a pharmacy network |
| [banking.yaml](./banking.yaml) | A card issuer | Card numbers (`pci`) only in a tokenization vault and never sent to the fraud model; an authorization decision with four outcomes; holds in a ledger |
| [ecommerce.yaml](./ecommerce.yaml) | An online store | A cart that becomes an order through a mapping; an order lifecycle; order events a warehouse subscribes to; only checkout may call the payment provider; a planned service |
| [logistics.yaml](./logistics.yaml) | A parcel network | Scanner events through a queue; a partner carrier calling in; a delivery-exception decision; a public tracking page that never shows contact details |
| [insurance.yaml](./insurance.yaml) | Motor claims | A decision with several inputs that hands off to an adjuster's journey (`next`); a payout less the excess; bank details kept from analytics |
| [energy.yaml](./energy.yaml) | An electricity utility | Smart-meter telemetry; an outage decision; a bill computed by a mapping; 15-minute readings treated as personal data; a deprecated system |

Open one in the explorer:

```sh
pnpm build
node packages/cli/dist/bin.js view examples/industries/banking.yaml --open
```

Then pick a journey and step through it, open a datastore's tables, or click a field to follow its lineage. `archdoc show authorize-purchase -m examples/industries/banking.yaml` prints a journey with each step's message.
