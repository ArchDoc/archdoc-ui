# Acme Rides: a demo org

Four repos that share their architecture through ArchDoc federation (roadmap Phase 4). Each folder stands for its own git repository:

| Repo | Namespace | Imports |
|---|---|---|
| `payments/` | `payments` | none |
| `trips/` | `trips` | `payments` |
| `rides/` | `rides` | `trips`, `payments` |
| `landscape/` | `acme` | all three, plus enterprise actors and a cross-team journey |

Imports use `git:` with a relative path (`git: ../payments`), so the folders work as sibling clones. The tests in `packages/federation/test` turn each folder into a git repository, tag releases, and run `archdoc sync`, `archdoc check`, and `archdoc publish` across them.

To try it by hand:

```bash
cp -r examples/acme /tmp/acme && cd /tmp/acme
for repo in payments trips rides landscape; do
  (cd $repo && git init -q && git add -A && git commit -qm init && git tag v1.0.0)
done
(cd payments && git tag v5.0.0) && (cd trips && git tag v3.0.0)
cd rides && archdoc sync && archdoc validate
```
