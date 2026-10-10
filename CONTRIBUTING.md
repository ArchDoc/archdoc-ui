# Contributing to ArchDoc

Thanks for helping! ArchDoc is in the middle of a relaunch. Read [`docs/revival/`](./docs/revival/README.md) first: it explains what we're building and why, and the roadmap says which phase is in progress.

## Ground rules

- **Dogfood.** ArchDoc models itself in [`.archdoc/`](./.archdoc). If your change adds, removes, or moves a package or a dependency between packages, update the model in the same PR.
- **The core stays deterministic.** `@archdoc/core` contains no LLM calls and no network access. Surfaces (CLI, MCP, web, Action) are thin adapters over core.
- **People approve, agents suggest.** Facts that an analyzer or an agent produces carry `provenance`. They become real only through a reviewed diff.
- **Exit tests, not dates.** A phase is done when its exit test passes on a real repo.

## Setup

You need Node 22.12+ (or 24) and pnpm 10.

```bash
corepack enable
pnpm install
```

| Command | What it does |
|---|---|
| `pnpm lint` | Biome lint and format check |
| `pnpm format` | Apply Biome fixes and formatting |
| `pnpm typecheck` | `tsc -b` for every package (also builds `dist/`), then typechecks tests |
| `pnpm test` | Vitest, run against package sources |

CI runs lint, typecheck, and test on Node 22 and 24 with `CI=true`.

## Making a change

1. Open or find an issue. For a change to the model format, use the **Spec change** template so the discussion happens before the code.
2. Branch from `main`, and keep the PR focused on one change.
3. Add or update tests next to the code (`packages/*/test`).
4. If the change affects a published package, run `pnpm changeset` and commit the generated file.
5. Open the PR. CI must be green before review.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(core): …`, `fix(cli): …`, `docs: …`, `chore: …`. The scope is the package name without `@archdoc/`.

## Code of conduct

This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md). By taking part, you agree to uphold it.
