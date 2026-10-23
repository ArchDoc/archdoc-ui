---
"@archdoc/core": minor
"@archdoc/analyzers": patch
---

`check` and `init` leave out build tooling: devDependencies in a manifest, and imports in a tool's config file (`eslint.config.js`, `tailwind.config.ts`, `vite.config.ts`). On a Turborepo monorepo, `init` went from 47 uses, most of them every package using its lint and tsconfig packages, to the 14 between its apps and packages. A runtime import of the same package still counts. Core exports `isDevTooling`.

The warning for an element nothing connects to says to connect it only with a use the code shows, or remove it, and the skill tells agents never to add a use to quiet a warning, and that describing what `init` wrote is the work. In first runs, agents had invented uses to clear these warnings.
