# Landscape repo template

A landscape repo composes every team's model into one, and adds what no single team owns: enterprise teams and roles, journeys that cross teams, business domains, and org-wide rules. `archdoc landscape build` checks the whole and publishes it as a static explorer site.

## Set it up

1. Create a repository, such as `your-org/architecture`, and copy [`.archdoc/`](./.archdoc) into it. List every team's repo under `imports`, with the version range to follow.
2. Run `archdoc sync` and commit `.archdoc/archdoc.lock` and `.archdoc/vendor/`. Teams' repos need release tags (`v1.2.0`) for sync to find.
3. Run `archdoc landscape build` to check the composed landscape: journeys across repos, owners that resolve to no team (an error here), and org rules on every declared relationship. It writes the explorer to `site/`. `archdoc view --landscape --watch` shows the same thing while you edit.
4. Copy [`workflows/archdoc-landscape.yml`](./workflows/archdoc-landscape.yml) to `.github/workflows/`. It opens a weekly pull request that takes every team's newest release, and publishes the site to GitHub Pages on every push to main. For private repos, add an `ARCHDOC_READ_TOKEN` secret that can read them.
5. Tag a release (`v1.0.0`), so team repos can import the landscape.

## Connect each team's repo

In each team's `.archdoc/archdoc.yaml`:

```yaml
landscape: { github: your-org/architecture, version: ^1 }
```

Then `archdoc sync` there. From then on:

- owners resolve against the landscape's teams, so `owners: [payments-team]` needs no local copy;
- the landscape's `scope: org` rules run in the repo's `archdoc check`;
- `archdoc impact`, the MCP tools, and the pull request comment list consumers and journeys in other repos, and the comment says which consumers a change breaks.

Run `archdoc sync --update landscape` (or schedule it) to take a new landscape release.

The demo org in [`examples/acme`](../../examples/acme) is a working landscape with three team repos.
