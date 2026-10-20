#!/usr/bin/env node
// Sets up the Acme demo org as real git repos, released and synced, with a
// branch ready for each scenario worth trying. Run it with `pnpm playground`.
//
//   pnpm playground            # set up .playground/ (replaces an earlier one)
//   pnpm playground --open     # then open the landscape in the explorer
//   pnpm playground /tmp/acme  # somewhere else

import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const open = args.includes("--open");
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? join(root, ".playground"));
const marker = join(dir, ".archdoc-playground");
const cli = join(root, "packages/cli/dist/bin.js");
const say = (s = "") => process.stdout.write(`${s}\n`);

// 1. Build ArchDoc, if it isn't built yet.
if (!existsSync(cli) || !existsSync(join(root, "apps/web/dist/index.html"))) {
  say("Building ArchDoc (pnpm build)…");
  execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
}

// 2. A fresh copy of the demo org. Only a directory this script made is ever deleted.
if (existsSync(dir)) {
  if (!existsSync(marker)) {
    console.error(`${dir} exists and isn't a playground. Pick another directory.`);
    process.exit(1);
  }
  rmSync(dir, { recursive: true, force: true });
}
mkdirSync(dir, { recursive: true });
cpSync(join(root, "examples/org"), dir, { recursive: true });
writeFileSync(marker, "Made by scripts/playground.mjs. Safe to delete.\n");

const git = (repo, ...a) =>
  execFileSync(
    "git",
    ["-c", "user.name=Playground", "-c", "user.email=playground@example.com", ...a],
    {
      cwd: join(dir, repo),
      stdio: "pipe",
    },
  ).toString();
const archdoc = (repo, ...a) =>
  execFileSync("node", [cli, ...a], { cwd: join(dir, repo), stdio: "pipe" }).toString();
const edit = (repo, file, from, to) => {
  const path = join(dir, repo, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${repo}/${file} no longer contains "${from}"`);
  writeFileSync(path, text.replace(from, to));
};

// 3. Each repo is a git repo; release them in dependency order, syncing imports first.
say(`Setting up the Acme demo org in ${relative(process.cwd(), dir) || "."}…`);
for (const repo of ["payments", "trips", "rides", "landscape"]) {
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
}
git("payments", "tag", "v5.0.0");
for (const [repo, tag] of [
  ["trips", "v3.0.0"],
  ["rides", "v1.0.0"],
  ["landscape", "v1.0.0"],
  ["payments", "v5.0.1"],
]) {
  archdoc(repo, "sync");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", `release ${tag}`);
  git(repo, "tag", tag);
  say(`  ${repo} ${tag}`);
}

// 4. A branch per scenario, so trying one is a checkout away.
const scenario = (repo, branch, message, change) => {
  git(repo, "checkout", "-q", "-b", branch);
  change();
  git(repo, "commit", "-q", "-am", message);
  git(repo, "checkout", "-q", "main");
};
scenario("payments", "try/pii-to-fraud", "Send refund requests to the fraud scorer", () =>
  edit(
    "payments",
    ".archdoc/archdoc.yaml",
    "sends: FraudCheck",
    "sends: [FraudCheck, RefundRequest]",
  ),
);
scenario("payments", "try/break-contract", "Rename the charges API", () =>
  edit(
    "payments",
    ".archdoc/archdoc.yaml",
    "api: proto/charges.proto",
    "api: proto/charges.v2.proto",
  ),
);
scenario("payments", "try/looser-refunds", "Approve larger refunds automatically", () =>
  edit(
    "payments",
    ".archdoc/data.yaml",
    "request.amount_cents <= charge.amount_cents / 2",
    "request.amount_cents <= charge.amount_cents * 3 / 4",
  ),
);
scenario("trips", "try/rename-email", "Rename rider_email", () => {
  writeFileSync(
    join(dir, "trips/migrations/002_rename_email.sql"),
    "ALTER TABLE trips RENAME COLUMN rider_email TO email;\n",
  );
  git("trips", "add", "-A");
});
writeFileSync(
  join(dir, "rides/samples/refund-large.json"),
  readFileSync(join(dir, "rides/samples/refund-overcharge.json"), "utf8").replace(
    '"amount_cents": 400',
    '"amount_cents": 1000',
  ),
);

// 5. An `archdoc` command for the playground, and what to try.
mkdirSync(join(dir, "bin"));
writeFileSync(join(dir, "bin/archdoc"), `#!/bin/sh\nexec node "${cli}" "$@"\n`, { mode: 0o755 });
writeFileSync(join(dir, "bin/archdoc.cmd"), `@node "${cli}" %*\r\n`);

const guide = `# ArchDoc playground

The Acme demo org: four git repos, released and synced. Put its \`archdoc\` on your PATH first:

    export PATH="${join(dir, "bin")}:$PATH"

Run \`pnpm playground\` in the ArchDoc repo again any time for a fresh copy.

| Repo | What it shows |
|---|---|
| payments | charges, refunds, the ledger; data read from a Prisma schema and a .proto; refund-approval logic |
| trips | trips, from a SQL migration; listens for refunds |
| rides | the rider app and gateway; the critical request-refund journey across all three |
| landscape | the whole org: teams, domains, org rules |

## Explore

    cd landscape && archdoc view --landscape --open   # group by repo, team, domain; Data section; click a field for lineage
    cd rides && archdoc view --open                    # open request-refund, press Run in Simulate, step with Next

## Data

    cd rides
    archdoc simulate request-refund --sample samples/refund-overcharge.json   # auto-approved: records and tables, step by step
    archdoc simulate request-refund --sample samples/refund-large.json        # needs finance: later steps skipped
    archdoc lineage payments.RefundRequest.amount_cents                       # from payments into trips' table
    archdoc show payments.Charge

## What a pull request would be told (each branch is one change)

    cd payments && git checkout try/pii-to-fraud     # sends personal data to a third party
    archdoc check --base main && archdoc report --base main

    cd payments && git checkout try/break-contract   # renames an API rides uses
    archdoc report --base main

    cd payments && git checkout try/looser-refunds   # changes the refund threshold
    archdoc report --base main

    cd trips && git checkout try/rename-email        # a migration renames a pii column
    archdoc check --base main

Go back with \`git checkout main\`.

## Edit and watch

    cd payments && archdoc view --watch --open   # edit .archdoc/*.yaml; the explorer reloads and shows problems
    archdoc validate
`;
writeFileSync(join(dir, "PLAYGROUND.md"), guide);

const here = relative(process.cwd(), dir) || ".";
say();
say(`Ready: ${dir}`);
say();
say(`  export PATH="${join(dir, "bin")}:$PATH"`);
say(
  `  cd ${join(here, "rides")} && archdoc simulate request-refund --sample samples/refund-overcharge.json`,
);
say(`  cd ${join(here, "landscape")} && archdoc view --landscape --open`);
say();
say(`More in ${join(here, "PLAYGROUND.md")}.`);

if (open) {
  say();
  say("Opening the landscape (Ctrl-C to stop)…");
  spawn("node", [cli, "view", "--landscape", "--open"], {
    cwd: join(dir, "landscape"),
    stdio: "inherit",
  });
}
