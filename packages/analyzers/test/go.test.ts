import { describe, expect, it } from "vitest";
import type { AnalyzerContext } from "../src/api.js";
import {
  type GoModule,
  goImports,
  goModules,
  indexGoSource,
  isGoSource,
  packageName,
  resolveGoImport,
} from "../src/go.js";

function memory(files: Record<string, string>): AnalyzerContext {
  return {
    baseDir: "/work/repo",
    files: Object.keys(files).sort(),
    read: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
  };
}

const edges = async (files: Record<string, string>, from?: string) =>
  (await goImports.analyze(memory(files)))
    .filter((d) => !from || d.from === from)
    .map((d) => [d.line, d.specifier, d.to, d.typeOnly ?? false]);

// A single-module service: cmd/server wires internal packages together.
const SHOP: Record<string, string> = {
  "go.mod": [
    "module github.com/acme/shop",
    "",
    "go 1.22",
    "",
    "require (",
    "\tgithub.com/acme/legacy v1.4.0",
    "\tgithub.com/acme/payments v0.9.0 // vendored client, see third_party",
    "\tgithub.com/google/uuid v1.6.0",
    "\tgithub.com/jackc/pgx/v5 v5.5.5",
    ")",
    "",
    "// The payments client is patched in-tree until upstream merges our fix.",
    "replace github.com/acme/payments => ./third_party/payments",
    "",
    "replace (",
    "\tgithub.com/acme/legacy v1.4.0 => ../legacy-orders // a local checkout",
    "\tgithub.com/google/uuid => github.com/acme/uuid v1.6.1",
    ")",
  ].join("\n"),
  "third_party/payments/go.mod": "module github.com/acme/payments\n\ngo 1.21\n",
  "third_party/payments/client/client.go": "package client\n\nfunc New() *Client { return nil }\n",
  "cmd/server/main.go": [
    "// Command server runs the shop's HTTP API.", // 1
    "package main",
    "",
    "import (",
    '\t"context"', // 5
    '\t"log/slog"',
    '\t"net/http"',
    '\t"os"',
    "",
    '\t"github.com/google/uuid"', // 10
    '\t"github.com/jackc/pgx/v5/pgxpool"',
    "",
    '\t"github.com/acme/shop/internal/api"',
    '\tcfg "github.com/acme/shop/internal/config" // loaded once at startup',
    '\t"github.com/acme/shop/internal/store"', // 15
    '\t_ "github.com/acme/shop/internal/store/migrations"',
    '\t// "github.com/acme/shop/internal/debug"',
    "\t/* payments are patched in third_party */",
    '\t"github.com/acme/payments/client"',
    '\tlegacy "github.com/acme/legacy/orders"', // 20
    ")",
    "",
    'const service = "github.com/acme/shop/internal/admin"',
    "",
    "func main() {", // 25
    "\tctx := context.Background()",
    '\tconf := cfg.MustLoad(os.Getenv("SHOP_CONFIG"))',
    "\tpool, err := pgxpool.New(ctx, conf.DatabaseURL)",
    "\tif err != nil {",
    '\t\tslog.Error("connect", "err", err)', // 30
    "\t\tos.Exit(1)",
    "\t}",
    "\th := api.NewRouter(store.New(pool), client.New(), legacy.Lookup)",
    '\tslog.Info("listening", "instance", uuid.NewString())',
    "\t_ = http.ListenAndServe(conf.Addr, h)", // 35
    "}",
  ].join("\n"),
  "internal/api/router.go": [
    "package api",
    "",
    'import "github.com/acme/shop/internal/store"',
    "",
    "import (",
    '\t. "github.com/acme/shop/internal/api/httputil"',
    '\t"net/http"',
    "\tdomain `github.com/acme/shop/internal/domain`",
    ")",
    "",
    "func NewRouter(s *store.Store, deps ...any) http.Handler { return Wrap(nil) }",
    "var _ domain.Order",
  ].join("\n"),
  "internal/store/store_test.go": [
    "package store_test",
    "",
    "import (",
    '\t"testing"',
    "",
    '\t"github.com/acme/shop/internal/store"',
    '\t"github.com/acme/shop/internal/store/storetest"',
    ")",
    "",
    "func TestGet(t *testing.T) { storetest.Seed(t, store.New(nil)) }",
  ].join("\n"),
  // The Go tool ignores these, and so does the analyzer.
  "internal/store/testdata/broken.go":
    'package broken\n\nimport "github.com/acme/shop/internal/store"\n',
  "vendor/github.com/google/uuid/uuid.go":
    'package uuid\n\nimport "github.com/acme/shop/internal/store"\n',
  "_scratch/try.go": 'package main\n\nimport "github.com/acme/shop/internal/api"\n',
  "web/src/index.ts": 'import "github.com/acme/shop/internal/api";\n',
};

describe("goImports", () => {
  it("resolves imports of the module's packages to their directories, from cmd/server", async () => {
    expect(await edges(SHOP, "cmd/server/main.go")).toEqual([
      [13, "github.com/acme/shop/internal/api", "internal/api", false],
      [14, "github.com/acme/shop/internal/config", "internal/config", false],
      [15, "github.com/acme/shop/internal/store", "internal/store", false],
      [16, "github.com/acme/shop/internal/store/migrations", "internal/store/migrations", false],
      // A local replace resolves to the directory it names.
      [19, "github.com/acme/payments/client", "third_party/payments/client", false],
    ]);
  });

  it("drops the standard library, third-party modules, and replaces pointing outside the repository", async () => {
    const specifiers = (await goImports.analyze(memory(SHOP))).map((d) => d.specifier);
    for (const outside of [
      "context",
      "net/http",
      "github.com/google/uuid",
      "github.com/jackc/pgx/v5/pgxpool",
      "github.com/acme/legacy/orders",
    ]) {
      expect(specifiers).not.toContain(outside);
    }
    // Neither a commented-out import nor a string that looks like one.
    expect(specifiers).not.toContain("github.com/acme/shop/internal/debug");
    expect(specifiers).not.toContain("github.com/acme/shop/internal/admin");
  });

  it("handles single, grouped, dot, aliased, and raw-string imports in one file", async () => {
    expect(await edges(SHOP, "internal/api/router.go")).toEqual([
      [3, "github.com/acme/shop/internal/store", "internal/store", false],
      [6, "github.com/acme/shop/internal/api/httputil", "internal/api/httputil", false],
      [8, "github.com/acme/shop/internal/domain", "internal/domain", false],
    ]);
  });

  it("marks imports in _test.go files as test-only", async () => {
    expect(await edges(SHOP, "internal/store/store_test.go")).toEqual([
      [6, "github.com/acme/shop/internal/store", "internal/store", true],
      [7, "github.com/acme/shop/internal/store/storetest", "internal/store/storetest", true],
    ]);
  });

  it("skips vendor/, testdata/, _-prefixed directories, and non-Go files", async () => {
    const from = new Set((await goImports.analyze(memory(SHOP))).map((d) => d.from));
    expect([...from].sort()).toEqual([
      "cmd/server/main.go",
      "internal/api/router.go",
      "internal/store/store_test.go",
    ]);
    expect(isGoSource("internal/store/store_test.go")).toBe(true);
    expect(isGoSource("vendor/github.com/x/y.go")).toBe(false);
    expect(isGoSource("pkg/testdata/a.go")).toBe(false);
    expect(isGoSource("pkg/.cache/a.go")).toBe(false);
  });

  it("finds nothing in a repository without go.mod", async () => {
    const rest = Object.fromEntries(
      Object.entries(SHOP).filter(([path]) => !path.endsWith("go.mod")),
    );
    expect(await goImports.analyze(memory(rest))).toEqual([]);
  });

  it("reports its name and the analyzer on each edge", async () => {
    const deps = await goImports.analyze(memory(SHOP));
    expect(goImports.name).toBe("go-imports");
    expect(new Set(deps.map((d) => d.analyzer))).toEqual(new Set(["go-imports"]));
  });
});

// A go.work monorepo: two services and a shared platform library.
const MONOREPO: Record<string, string> = {
  "go.work": [
    "go 1.22",
    "",
    "use (",
    "\t./services/billing",
    "\t./libs/platform",
    ")",
    "",
    "// Patched in-tree for the JetStream ack fix.",
    "replace github.com/nats-io/nats.go v1.31.0 => ./third_party/nats.go",
  ].join("\n"),
  "services/billing/go.mod": [
    "module github.com/acme/billing",
    "",
    "go 1.22",
    "",
    "require (",
    "\tgithub.com/acme/platform v0.0.0",
    "\tgithub.com/nats-io/nats.go v1.31.0",
    ")",
  ].join("\n"),
  "services/catalog/go.mod": [
    "module github.com/acme/catalog",
    "",
    "go 1.21",
    "",
    "require github.com/acme/platform v0.3.0",
    "",
    "// Built against a local checkout of platform, outside this repository.",
    "replace github.com/acme/platform => ../../../platform",
  ].join("\n"),
  "libs/platform/go.mod": "module github.com/acme/platform\n\ngo 1.22\n",
  "third_party/nats.go/go.mod": "module github.com/nats-io/nats.go\n\ngo 1.20\n",
  "services/billing/cmd/billing/main.go": [
    "package main",
    "",
    "import (",
    '\t"github.com/acme/billing/internal/invoice"',
    '\t"github.com/acme/platform/telemetry"',
    '\t"github.com/nats-io/nats.go"',
    '\t"github.com/nats-io/nats.go/jetstream"',
    ")",
    "",
    "func main() {",
    "\tnc, _ := nats.Connect(nats.DefaultURL)",
    "\tjs, _ := jetstream.New(nc)",
    "\tinvoice.Run(js, telemetry.Default())",
    "}",
  ].join("\n"),
  "services/billing/internal/invoice/invoice.go": [
    "package invoice",
    "",
    'import "github.com/acme/catalog/pkg/sku"',
    "",
    "func Run(deps ...any) { _ = sku.Parse }",
  ].join("\n"),
  "services/catalog/pkg/sku/sku.go": [
    "package sku",
    "",
    'import "github.com/acme/platform/telemetry"',
    "",
    "func Parse(s string) string { telemetry.Count(); return s }",
  ].join("\n"),
  "libs/platform/telemetry/telemetry.go":
    "package telemetry\n\nfunc Default() any { return nil }\n",
};

describe("goImports in a multi-module repository", () => {
  it("lists every module with its directory, longest path first", async () => {
    const modules = await goModules(memory(MONOREPO));
    expect(modules.map((m) => [m.path, m.dir, m.manifest])).toEqual([
      ["github.com/nats-io/nats.go", "third_party/nats.go", "third_party/nats.go/go.mod"],
      ["github.com/acme/platform", "libs/platform", "libs/platform/go.mod"],
      ["github.com/acme/billing", "services/billing", "services/billing/go.mod"],
      ["github.com/acme/catalog", "services/catalog", "services/catalog/go.mod"],
    ]);
    // go.work's replace applies to every module under it; catalog's own replace leaves the repository.
    expect(modules.find((m) => m.path === "github.com/acme/catalog")?.replaces).toEqual([
      { path: "github.com/nats-io/nats.go", dir: "third_party/nats.go" },
      { path: "github.com/acme/platform", dir: undefined },
    ]);
  });

  it("resolves imports across modules and go.work replaces", async () => {
    expect(await edges(MONOREPO)).toEqual([
      [4, "github.com/acme/billing/internal/invoice", "services/billing/internal/invoice", false],
      [5, "github.com/acme/platform/telemetry", "libs/platform/telemetry", false],
      [6, "github.com/nats-io/nats.go", "third_party/nats.go", false],
      [7, "github.com/nats-io/nats.go/jetstream", "third_party/nats.go/jetstream", false],
      [3, "github.com/acme/catalog/pkg/sku", "services/catalog/pkg/sku", false],
      // catalog replaces platform with code outside the repository: no edge from sku.go.
    ]);
  });
});

describe("resolveGoImport", () => {
  const modules: GoModule[] = [
    {
      path: "example.com/app/tools",
      dir: "tools",
      manifest: "tools/go.mod",
      replaces: [],
    },
    {
      path: "example.com/app",
      dir: "",
      manifest: "go.mod",
      replaces: [
        { path: "example.com/protos", dir: "gen/protos" },
        { path: "example.com/app/legacy", dir: undefined },
      ],
    },
  ];

  it("maps the module root to '.', nested modules to their own directory", () => {
    expect(resolveGoImport("main.go", "example.com/app", modules)).toBe(".");
    expect(resolveGoImport("main.go", "example.com/app/internal/x", modules)).toBe("internal/x");
    expect(resolveGoImport("main.go", "example.com/app/tools/gen", modules)).toBe("tools/gen");
    expect(resolveGoImport("main.go", "example.com/application", modules)).toBeUndefined();
  });

  it("applies the importing module's replaces, even to a path inside a repository module", () => {
    expect(resolveGoImport("cmd/a/main.go", "example.com/protos/v1/orders", modules)).toBe(
      "gen/protos/v1/orders",
    );
    expect(resolveGoImport("cmd/a/main.go", "example.com/app/legacy/db", modules)).toBeUndefined();
    // tools/go.mod declares no replace.
    expect(resolveGoImport("tools/gen/main.go", "example.com/protos/v1", modules)).toBeUndefined();
  });
});

describe("packageName", () => {
  it("guesses a package's name from its import path the way goimports does", () => {
    expect(packageName("net/http")).toBe("http");
    expect(packageName("github.com/jackc/pgx/v5")).toBe("pgx");
    expect(packageName("gopkg.in/yaml.v3")).toBe("yaml");
    expect(packageName("github.com/go-chi/chi/v5")).toBe("chi");
    expect(packageName("github.com/mattn/go-sqlite3")).toBe("sqlite3");
    expect(packageName("github.com/nats-io/nats.go")).toBe("nats");
  });
});

const STORE = [
  "// Package store persists orders in Postgres.", // 1
  "package store",
  "",
  "import (",
  '\t"context"', // 5
  '\t"errors"',
  '\t"fmt"',
  "",
  '\t"github.com/jackc/pgx/v5/pgxpool"',
  "", // 10
  '\t"github.com/acme/shop/internal/domain"',
  '\tsq "github.com/acme/shop/internal/store/query"',
  '\t_ "github.com/acme/shop/internal/store/migrations"',
  ")",
  "", // 15
  "// ErrNotFound is returned when an order doesn't exist.",
  'var ErrNotFound = errors.New("store: not found")',
  "",
  "const (",
  "\tDefaultPageSize = 50 // rows", // 20
  "\tMaxPageSize     = 500",
  '\ttableOrders     = "orders"',
  '\teventCreated    = "order-created"',
  ")",
  "", // 25
  "var (",
  "\tReadTimeout, WriteTimeout = 5, 10",
  "\tdefaultLimit              = 20",
  ")",
  "", // 30
  "// Store reads and writes orders.",
  "type Store struct {",
  "\tpool *pgxpool.Pool",
  '\ttag  string `json:"store_tag"`',
  "}", // 35
  "",
  "type Querier interface {",
  "\tQuery(ctx context.Context, sql string, args ...any) (Rows, error)",
  "}",
  "", // 40
  "type (",
  "\tOrderID string",
  "\tRows    = []domain.Order",
  "\tscanner func(dest ...any) error",
  ")", // 45
  "",
  "type Page[T any] struct {",
  "\tItems []T",
  "\tNext  string",
  "}", // 50
  "",
  "type Batch [16]OrderID",
  "",
  "func New(pool *pgxpool.Pool) *Store {",
  "\treturn &Store{pool: pool}", // 55
  "}",
  "",
  "func (s *Store) Get(ctx context.Context, id OrderID) (domain.Order, error) {",
  '\tq := sq.Select(tableOrders).Where("order_id", id)',
  "\tif err := s.pool.QueryRow(ctx, q.SQL()).Scan(); err != nil {", // 60
  '\t\treturn domain.Order{}, fmt.Errorf("get %s: %w", id, ErrNotFound)',
  "\t}",
  "\treturn domain.Order{ID: string(id)}, nil",
  "}",
  "", // 65
  "func (p *Page[T]) Len() int { return len(p.Items) }",
  "func (s *Store) list() {}",
  "func (c *cursor) Next() bool { return false }",
  "type cursor struct{}",
  "func init() { _ = `multi", // 70
  "line raw string` }",
  "func Paginate[T any](items []T, size int) [][]T {",
  '\treturn nil // "not-a-literal" in a comment',
  "}",
].join("\n");

describe("indexGoSource", () => {
  const src = indexGoSource("internal/store/store.go", STORE, (spec) =>
    spec.startsWith("github.com/acme/shop/")
      ? spec.slice("github.com/acme/shop/".length)
      : undefined,
  );

  it("lists exported funcs, methods, types, consts, and vars with their kind and line", () => {
    expect(src.exports.map((e) => [e.name, e.kind, e.line])).toEqual([
      ["ErrNotFound", "var", 17],
      ["DefaultPageSize", "const", 20],
      ["MaxPageSize", "const", 21],
      ["ReadTimeout", "var", 27],
      ["WriteTimeout", "var", 27],
      ["Store", "class", 32],
      ["Querier", "interface", 37],
      ["OrderID", "type", 42],
      ["Rows", "type", 43],
      ["Page", "class", 47],
      ["Batch", "type", 52],
      ["New", "function", 54],
      ["Store.Get", "function", 58],
      ["Page.Len", "function", 66],
      ["Paginate", "function", 72],
    ]);
  });

  it("lists imports, where they resolve, and where the package and its names are first used", () => {
    expect(src.imports).toEqual([
      {
        specifier: "context",
        target: undefined,
        line: 5,
        names: [
          { name: "context", line: 38 },
          { name: "Context", line: 38 },
        ],
      },
      {
        specifier: "errors",
        target: undefined,
        line: 6,
        names: [
          { name: "errors", line: 17 },
          { name: "New", line: 17 },
        ],
      },
      {
        specifier: "fmt",
        target: undefined,
        line: 7,
        names: [
          { name: "fmt", line: 61 },
          { name: "Errorf", line: 61 },
        ],
      },
      {
        specifier: "github.com/jackc/pgx/v5/pgxpool",
        target: undefined,
        line: 9,
        names: [
          { name: "pgxpool", line: 33 },
          { name: "Pool", line: 33 },
        ],
      },
      {
        specifier: "github.com/acme/shop/internal/domain",
        target: "internal/domain",
        line: 11,
        names: [
          { name: "domain", line: 43 },
          { name: "Order", line: 43 },
        ],
      },
      {
        specifier: "github.com/acme/shop/internal/store/query",
        target: "internal/store/query",
        line: 12,
        names: [
          { name: "query", local: "sq", line: 59 },
          { name: "Select", line: 59 },
        ],
      },
      {
        specifier: "github.com/acme/shop/internal/store/migrations",
        target: "internal/store/migrations",
        line: 13,
        names: [{ name: "migrations", local: "_" }],
      },
    ]);
  });

  it("keeps identifier-like string literals, not struct tags, import paths, or comments", () => {
    expect(src.literals).toEqual([
      { text: "order-created", line: 23 },
      { text: "order_id", line: 59 },
    ]);
  });

  it("tolerates broken code", () => {
    const broken = indexGoSource("x.go", 'package x\n\nimport (\n\t"fmt\nfunc Bad( {\n/* open');
    expect(broken.path).toBe("x.go");
    expect(broken.exports).toEqual([]);
  });
});
