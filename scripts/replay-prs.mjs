// Replays a repository's last merged pull requests through `archdoc report`,
// with the CLI built from this checkout, and counts how many would get a
// comment and how many would block (MVP plan §8). Read every block: the
// target is that each one is real.
//
//   pnpm build
//   node scripts/replay-prs.mjs [repo] [--limit 50] [--branch main] [--model dir] [--show]
//
// repo defaults to this one; it needs the history (not a shallow clone) and a
// model in .archdoc/ at the commits replayed. For a repository whose history
// has no model, --model copies one (such as the .archdoc/ init and an agent
// just wrote) into every commit, the way eval uses the model as it is now. A merge commit is replayed as
// its second parent against the merge base; a squashed or rebased commit as
// itself against its parent. --show prints each blocking report.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const here = new URL("..", import.meta.url).pathname;
const cli = join(here, "packages/cli/dist/bin.js");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [v] = args.splice(i, 2).slice(1);
  return v;
};
const show = args.includes("--show");
const limit = Number(flag("--limit", "50"));
const branch = flag("--branch", undefined);
const modelNow = flag("--model", undefined);
const modelDir = modelNow && resolve(modelNow);
const repo = resolve(args.find((a) => !a.startsWith("--")) ?? here);

const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
const target =
  branch ?? (git("rev-parse", "--verify", "-q", "origin/main") ? "origin/main" : "HEAD");

const commits = git("log", "--first-parent", `-n${limit}`, "--format=%H %P\t%s", target)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [ids, subject] = line.split("\t");
    const [sha, first, second] = ids.split(" ");
    return { sha, first, second, subject };
  });

const work = mkdtempSync(join(tmpdir(), "archdoc-replay-"));
const tree = join(work, "tree");
const rows = [];
try {
  for (const c of commits) {
    if (!c.first) continue;
    const head = c.second ?? c.sha;
    const base = c.second ? git("merge-base", c.first, c.second) : c.first;
    let verdict;
    let lines = 0;
    let report = "";
    try {
      let against = base;
      if (modelDir) {
        // The same model on both sides, committed in the worktree, so the
        // report sees only the PR's code change.
        const at = (...a) =>
          execFileSync("git", ["-C", tree, ...a], { encoding: "utf8", stdio: "pipe" }).trim();
        const commitModel = () => {
          rmSync(join(tree, ".archdoc"), { recursive: true, force: true });
          cpSync(modelDir, join(tree, ".archdoc"), { recursive: true });
          at("add", "-A", "-f", ".");
          const id = ["-c", "user.name=replay", "-c", "user.email=replay@archdoc"];
          at(...id, "commit", "-q", "--no-verify", "--allow-empty", "-m", "replay");
          return at("rev-parse", "HEAD");
        };
        git("worktree", "add", "-q", "--detach", "-f", tree, base);
        against = commitModel();
        // The PR's tree on top of it, so the merge base is the base with the model.
        at("read-tree", "--reset", "-u", head);
        at("clean", "-fdq");
        commitModel();
      } else {
        git("worktree", "add", "-q", "--detach", "-f", tree, head);
      }
      if (!existsSync(join(tree, ".archdoc")))
        throw Object.assign(new Error(), { stderr: "no model" });
      report = execFileSync("node", [cli, "report", "--base", against, "--model", "."], {
        cwd: tree,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      verdict = /<!-- archdoc-verdict: ([a-z]+) -->/.exec(report)?.[1] ?? "unknown";
      lines = report.split("\n").length;
    } catch (e) {
      verdict = /no model|No \.archdoc|not found/i.test(String(e.stderr)) ? "no model" : "error";
      report = String(e.stderr ?? e.message);
    } finally {
      try {
        git("worktree", "remove", "--force", tree);
      } catch {}
    }
    rows.push({ ...c, verdict, lines, report });
    const pr = /#(\d+)/.exec(c.subject)?.[1];
    console.log(
      `${verdict.padEnd(9)} ${String(lines).padStart(4)} lines  ${c.sha.slice(0, 7)} ${pr ? `#${pr} ` : ""}${c.subject.slice(0, 80)}`,
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
  try {
    git("worktree", "prune");
  } catch {}
}

const replayed = rows.filter((r) => !["no model", "error"].includes(r.verdict));
const count = (...v) => replayed.filter((r) => v.includes(r.verdict)).length;
const pct = (n) => (replayed.length ? `${Math.round((n / replayed.length) * 100)}%` : "–");
const commented = count("attention", "blocking");
const blocked = count("blocking");
console.log(`
Replayed ${replayed.length} of ${rows.length} (${rows.length - replayed.length} without a model or failed).
Would comment: ${commented} (${pct(commented)}), of which block: ${blocked} (${pct(blocked)}).
Job summary only: ${count("info", "none")} (${pct(count("info", "none"))}).
Target: under 20% get a comment, and every block is real.`);

if (show) {
  for (const r of replayed.filter((x) => x.verdict === "blocking")) {
    console.log(`\n${"=".repeat(72)}\n${r.sha.slice(0, 7)} ${r.subject}\n${"=".repeat(72)}`);
    console.log(r.report.split("\n").slice(0, 40).join("\n"));
  }
}
