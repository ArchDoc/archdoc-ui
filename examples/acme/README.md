# Acme Rides: a demo org

Four repos that share their architecture through ArchDoc federation (roadmap Phase 4). Each folder stands for its own git repository:

| Repo | Namespace | Imports |
|---|---|---|
| `payments/` | `payments` | none |
| `trips/` | `trips` | `payments` |
| `rides/` | `rides` | `trips`, `payments` |
| `landscape/` | `acme` | all three, plus enterprise actors and a cross-team journey |

Imports use `git:` with a relative path (`git: ../payments`), so the folders work as sibling clones. The tests in `packages/federation/test` turn each folder into a git repository, tag releases, and run `archdoc sync`, `archdoc check`, and `archdoc publish` across them.

## Playground

From the ArchDoc repo, `pnpm playground` does all of the setup below in `.playground/` (git repos, release tags, `archdoc sync`) and adds a branch for each scenario:

| Repo | Branch | What it changes | Try |
|---|---|---|---|
| payments | `try/pii-to-fraud` | sends `RefundRequest` (pii) to the external fraud scorer | `archdoc check --base main`, `archdoc report --base main` |
| payments | `try/break-contract` | renames the charges API rides uses | `archdoc report --base main` |
| payments | `try/looser-refunds` | raises the auto-approve threshold | `archdoc report --base main` |
| trips | `try/rename-email` | a migration renames `rider_email` (pii) | `archdoc check --base main` |

It writes `PLAYGROUND.md` with every command, and an `archdoc` command in `.playground/bin`.

To try it by hand:

```bash
cp -r examples/acme /tmp/acme && cd /tmp/acme
for repo in payments trips rides landscape; do
  (cd $repo && git init -q && git add -A && git commit -qm init && git tag v1.0.0)
done
(cd payments && git tag v5.0.0) && (cd trips && git tag v3.0.0)
cd rides && archdoc sync && archdoc validate
```

The repos also carry data: payments reads its entries from a Prisma schema and a `.proto`, trips from a SQL migration, and the refund journey in rides decides with payments' `refund-approval` logic. After syncing:

```bash
cd rides
archdoc simulate request-refund --sample samples/refund-overcharge.json   # the branch, records, and tables
archdoc lineage payments.RefundRequest.amount_cents                       # where the amount goes, across repos
```
