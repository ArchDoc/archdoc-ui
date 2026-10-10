import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Lock } from "@archdoc/spec";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildModel,
  createBundle,
  type FederationInput,
  federate,
  integrityOf,
  loadModel,
  lookupImported,
  modelFromBundle,
  serializeBundle,
} from "../src/index.js";
import { dedent } from "./helpers.js";

const paymentsSources = [
  {
    path: "archdoc.yaml",
    text: dedent(`
      archdoc: "2.0"
      namespace: payments
      imports:
        org: { github: acme/org, version: ^1 }
        rides: { github: acme/rides, version: ^1 }
      actors:
        clerk: { kind: role, uses: { charges: Refunds } }
      elements:
        charges:
          kind: container
          provides:
            - { api: proto/charges.proto }
            - { topic: refund.issued }
            - { api: rest/v1, status: deprecated }
          uses: { ledger: Records, rides.notify: Tells riders }
          elements:
            refunds: { kind: component }
        ledger: { kind: datastore }
        legacy: { kind: container, status: deprecated }
    `),
  },
];

const payments = (version: string, imports?: Record<string, string>) => {
  const { bundle } = createBundle(paymentsSources, "archdoc.yaml", {
    version,
    commit: "a".repeat(40),
    source: "github:acme/payments",
    imports,
  });
  if (!bundle) throw new Error("payments doesn't build");
  return serializeBundle(bundle);
};

const rides = (extra = "") =>
  buildModel([
    {
      path: "archdoc.yaml",
      text: dedent(`
        archdoc: "2.0"
        namespace: rides
        imports:
          payments: { github: acme/payments, version: ^5 }
          org: { github: acme/org, version: ^2 }
        actors:
          rider: { kind: person, uses: { app: Books, payments.charges: Disputes } }
        elements:
          app: { kind: container, uses: { notify: Pings } }
          notify: { kind: container }
          gateway:
            kind: container
            uses:
              payments.charges: { description: Charges, via: proto/charges.proto }
              payments.charges.refunds: Refunds
              payments.ledger: Reads
        ${extra}
      `).replace(/\n {2}(?=\S)/g, "\n  "),
    },
  ]);

const lockFor = (
  bundles: Record<string, string>,
  override: Partial<Lock["imports"][string]> = {},
) =>
  ({
    lockfileVersion: 1,
    imports: Object.fromEntries(
      Object.entries(bundles).map(([ns, text]) => [
        ns,
        {
          source: `github:acme/${ns}`,
          requested: ns === "org" ? "^2" : "^5",
          version: JSON.parse(text).version,
          bundle: `vendor/${ns}.json`,
          integrity: integrityOf(text),
          ...override,
        },
      ]),
    ),
  }) satisfies Lock;

const input = (
  bundles: Record<string, string>,
  lock: Lock = lockFor(bundles),
): FederationInput => ({
  lockPath: ".archdoc/archdoc.lock",
  lock,
  bundles: new Map(
    Object.entries(bundles).map(([ns, text]) => [
      ns,
      { path: `.archdoc/vendor/${ns}.json`, text, integrity: integrityOf(text) },
    ]),
  ),
});

const codes = (m: { diagnostics: { code: string; severity: string }[] }) =>
  m.diagnostics.filter((d) => d.severity !== "info").map((d) => d.code);
const messages = (m: { diagnostics: { code: string; message: string }[] }, code: string) =>
  m.diagnostics.filter((d) => d.code === code).map((d) => d.message);

describe("bundles", () => {
  it("pack a model's files with where they came from, and rebuild the same model", () => {
    const text = payments("5.2.0", { org: "1.4.0" });
    const bundle = JSON.parse(text);
    expect(bundle).toMatchObject({
      archdocBundle: 1,
      namespace: "payments",
      version: "5.2.0",
      source: "github:acme/payments",
      imports: { org: "1.4.0" },
      root: "archdoc.yaml",
    });
    const m = modelFromBundle(bundle);
    expect([...m.elements.keys()]).toEqual(["charges", "charges.refunds", "ledger", "legacy"]);
    expect(m.files).toEqual(["payments@5.2.0:archdoc.yaml"]);
  });

  it("refuse a model with errors", () => {
    const { bundle, model } = createBundle(
      [{ path: "a.yaml", text: 'archdoc: "2.0"\nnamespace: x\nelements: { a: { kind: box } }' }],
      "a.yaml",
    );
    expect(bundle).toBeUndefined();
    expect(model.diagnostics[0]?.code).toBe("schema/invalid");
  });
});

describe("federate", () => {
  const org = serializeBundleText("org", "2.0.0");

  it("checks references into other repos at the pinned version", () => {
    const m = federate(rides(), input({ payments: payments("5.2.0"), org }));
    expect(codes(m)).toEqual([]);
    expect([...(m.imported?.keys() ?? [])]).toEqual(["payments", "org"]);
    expect(lookupImported(m.imported ?? new Map(), "payments.charges.refunds")).toMatchObject({
      status: "found",
      node: { id: "charges.refunds" },
    });
  });

  it("flags references that don't resolve, with a hint, and deprecated targets", () => {
    const m = federate(
      rides(`
          billing:
            kind: container
            uses:
              payments.refunds: Refunds
              payments.legacy: Old
              payments.charges: { description: Old API, via: rest/v1 }
              payments.queue: { description: Gone, via: x }`),
      input({ payments: payments("5.2.0"), org }),
    );
    expect(messages(m, "ref/unknown-in-import")).toEqual([
      "billing uses payments.refunds, which payments@5.2.0 doesn't have. Did you mean payments.charges.refunds?",
      "billing uses payments.queue, which payments@5.2.0 doesn't have.",
    ]);
    expect(messages(m, "ref/deprecated-target")).toEqual([
      "billing uses payments.legacy, which is deprecated in payments@5.2.0.",
    ]);
    expect(messages(m, "ref/deprecated-contract")).toEqual([
      'billing uses payments.charges via "rest/v1", which is deprecated.',
    ]);
  });

  it("checks via against what the target provides", () => {
    const m = federate(
      rides(`
          billing: { kind: container, uses: { payments.charges: { description: x, via: proto/refunds.proto } } }`),
      input({ payments: payments("5.2.0"), org }),
    );
    expect(messages(m, "ref/unknown-contract")).toEqual([
      'billing uses payments.charges via "proto/refunds.proto", but payments.charges doesn\'t provide it. It provides: proto/charges.proto, refund.issued, rest/v1.',
    ]);
  });

  it("verifies journey steps that start in another repo", () => {
    const m = federate(
      rides(`
        journeys:
          refund:
            actor: rider
            goal: Get money back
            steps:
              - { from: rider, to: app }
              - { from: gateway, to: payments.charges }
              - { from: payments.charges, to: payments.ledger }
              - { from: payments.charges, to: notify }
              - { from: payments.charges, to: rider }
              - { from: payments.ledger, to: payments.charges }
              - { from: payments.nope, to: notify }`),
      input({ payments: payments("5.2.0"), org }),
    );
    expect(m.diagnostics.filter((d) => d.code === "journey/unverified-step")).toEqual([]);
    expect(messages(m, "journey/broken-step")).toEqual([
      'Journey "refund", step 6: payments.ledger → payments.charges doesn\'t follow a relationship that payments@5.2.0 declares.',
    ]);
    expect(messages(m, "ref/unknown-in-import")).toEqual([
      'Journey "refund", step 7: refers to payments.nope, which payments@5.2.0 doesn\'t have.',
    ]);
  });

  it("leaves imports alone until they're synced", () => {
    const m = federate(rides("  billing: { kind: container, uses: { payments.nope: x } }"), {
      lockPath: ".archdoc/archdoc.lock",
      bundles: new Map(),
    });
    expect(codes(m)).toEqual(["import/not-synced", "import/not-synced"]);
    expect(m.diagnostics[0]?.location).toMatchObject({ file: "archdoc.yaml", line: 4 });
  });

  it("flags a lockfile that's out of date, edited, incomplete, or stale", () => {
    const p = payments("5.2.0");
    const lock = lockFor({ payments: p, org });
    const ok = (lock.imports.payments as Lock["imports"][string]).integrity;
    expect(
      codes(
        federate(
          rides(),
          input({ payments: p, org }, lockFor({ payments: p, org }, { requested: "^4" })),
        ),
      ),
    ).toEqual(["import/out-of-date", "import/out-of-date"]);

    const edited = input({ payments: p, org });
    edited.bundles = new Map([
      ...edited.bundles,
      ["payments", { path: "x", text: `${p} `, integrity: "sha256-x" }],
    ]);
    expect(codes(federate(rides(), edited))).toEqual(["import/modified-bundle"]);

    const missing = input({ payments: p, org });
    missing.bundles = new Map([["org", missing.bundles.get("org") as never]]);
    expect(codes(federate(rides(), missing))).toEqual(["import/missing-bundle"]);

    const extra = input({ payments: p, org });
    extra.lock = {
      ...lock,
      imports: { ...lock.imports, trips: { ...lock.imports.payments, integrity: ok } as never },
    };
    expect(codes(federate(rides(), extra))).toEqual(["import/unused-lock-entry"]);

    const wrong = input({ payments: serializeBundleText("payments-v2", "5.0.0"), org });
    expect(codes(federate(rides(), wrong))).toEqual(["import/namespace-mismatch"]);

    expect(
      codes(
        federate(rides(), { lockPath: "l", lockError: "lockfileVersion: bad", bundles: new Map() }),
      ),
    ).toEqual(["import/invalid-lock"]);
  });

  it("warns when an import was built against a different major version", () => {
    const m = federate(rides(), input({ payments: payments("5.2.0", { org: "1.4.0" }), org }));
    expect(messages(m, "import/version-skew")).toEqual([
      "payments@5.2.0 was built against org 1.4.0, but this repo pins org 2.0.0. What payments says about org may not hold.",
    ]);
  });
});

describe("loadModel", () => {
  const dirs: string[] = [];
  afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

  it("reads archdoc.lock and the vendored bundles next to the model", async () => {
    const repo = await mkdtemp(join(tmpdir(), "archdoc-fed-"));
    dirs.push(repo);
    const p = payments("5.2.0");
    await mkdir(join(repo, ".archdoc", "vendor"), { recursive: true });
    await writeFile(
      join(repo, ".archdoc", "archdoc.yaml"),
      'archdoc: "2.0"\nnamespace: rides\nimports:\n  payments: { github: acme/payments, version: ^5 }\nelements:\n  gateway: { kind: container, uses: { payments.charges: Charges, payments.gone: Old } }\n',
    );
    await writeFile(join(repo, ".archdoc", "vendor", "payments@5.2.0.json"), p);
    await writeFile(
      join(repo, ".archdoc", "archdoc.lock"),
      `lockfileVersion: 1\nimports:\n  payments:\n    source: github:acme/payments\n    requested: ^5\n    version: 5.2.0\n    bundle: vendor/payments@5.2.0.json\n    integrity: ${integrityOf(p)}\n`,
    );
    const m = await loadModel(".", { cwd: repo });
    expect(m.imported?.get("payments")?.version).toBe("5.2.0");
    expect(m.diagnostics.map((d) => `${d.code} ${d.location?.file}:${d.location?.line}`)).toEqual([
      "ref/unknown-in-import .archdoc/archdoc.yaml:6",
    ]);
  });
});

function serializeBundleText(namespace: string, version: string): string {
  const { bundle } = createBundle(
    [{ path: "archdoc.yaml", text: `archdoc: "2.0"\nnamespace: ${namespace}\n` }],
    "archdoc.yaml",
    { version },
  );
  return serializeBundle(bundle as NonNullable<typeof bundle>);
}
