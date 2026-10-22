import { describe, expect, it } from "vitest";
import type { AnalyzerContext } from "../src/api.js";
import {
  indexPythonCode,
  indexPythonSource,
  pythonImports,
  pythonRoots,
  resolvePythonModule,
} from "../src/python.js";

// A small FastAPI-shaped shop in a `src/` layout, a worker project with its own
// pyproject.toml, a Django-style manage.py, tests without __init__.py, and a
// virtualenv that must never count as the repository's code.
const files: Record<string, string> = {
  "pyproject.toml": '[project]\nname = "shop"\n',
  "manage.py": [
    "#!/usr/bin/env python", // 1
    "import os",
    "import sys",
    "from shop import settings",
    "from shop.wsgi import application  # no wsgi.py: the package itself", // 5
    "import fastapi",
  ].join("\n"),
  "src/shop/__init__.py": [
    '"""The shop."""', // 1
    "from .models import Order",
    "from .services import *",
  ].join("\n"),
  "src/shop/settings.py": [
    "import os", // 1
    "",
    'DEBUG = os.environ.get("DEBUG") == "1"',
    'CURRENCY = "usd"',
    "TAX_RATE, SHIPPING = 0.2, 5", // 5
    'db_url = os.environ["DATABASE_URL"]',
    '_secret = "x"',
    "if DEBUG:",
    '    LOG_LEVEL = "debug-verbose"',
    "else:", // 10
    '    LOG_LEVEL = "info"',
    "try:",
    "    from .local_settings import *",
    "except ImportError:",
    "    pass", // 15
    "",
    "",
    "def configure(**overrides):",
    "    level = overrides",
    "    return level", // 20
    "handler = lambda x=1: x",
    "DEBUG == True",
    "os.environ['X'] = '1'",
  ].join("\n"),
  "src/shop/models.py": [
    '"""Order models."""', // 1
    "from __future__ import annotations",
    "",
    "import enum",
    "from dataclasses import dataclass, field", // 5
    "",
    "from .settings import CURRENCY, TAX_RATE as RATE",
    "",
    '__all__ = ["Order", "OrderStatus", "DEFAULT_STATUS", "make_order", "_hidden"]',
    "", // 10
    'DEFAULT_STATUS = "pending"',
    "MAX_ITEMS: int = 50",
    "_cache = {}",
    "",
    "", // 15
    "class OrderStatus(enum.Enum):",
    '    PENDING = "pending"',
    '    SHIPPED = "order-shipped"',
    "",
    "", // 20
    "@dataclass",
    "class Order:",
    "    id: int",
    "    currency: str = CURRENCY",
    "", // 25
    "    def total(self) -> float:",
    "        return self.subtotal * (1 + RATE)",
    "",
    "",
    "def make_order(id: int) -> Order:", // 30
    "    return Order(id=id)",
    "",
    "",
    "async def _hidden():",
    "    ...", // 35
  ].join("\n"),
  "src/shop/services/__init__.py": "",
  "src/shop/services/billing.py":
    "class Invoice:\n    pass\n\ndef invoice_for(order):\n    return Invoice()\n",
  "src/shop/services/email.py": "def send(template, order):\n    pass\n\ndef render():\n    pass\n",
  "src/shop/api/__init__.py": "",
  "src/shop/api/deps.py": "def get_db():\n    pass\n\ndef get_user():\n    pass\n",
  "src/shop/api/routes.py": [
    '"""Routes for the shop API.', // 1
    "",
    "import shop.secret_docstring_import",
    '"""',
    "from __future__ import annotations", // 5
    "",
    "import logging",
    "from typing import TYPE_CHECKING",
    "",
    "from fastapi import APIRouter, Depends", // 10
    "",
    "from ..models import Order, OrderStatus",
    "from ..services import billing, email as mailer",
    "from . import deps",
    "from .deps import (", // 15
    "    get_db,",
    "    get_user,  # the current user)",
    ")",
    "import shop.settings as conf",
    "# from shop.services import commented_out", // 20
    "",
    "if TYPE_CHECKING:",
    "    from shop.services.billing import Invoice",
    "    from sqlalchemy.orm import Session",
    "", // 25
    'router = APIRouter(prefix="/orders")',
    'SQL = "import shop.models"',
    "",
    "",
    '@router.get("/{order_id}")', // 30
    'async def get_order(order_id: int, db: "Session" = Depends(get_db)):',
    "    order = db.get(Order, order_id)",
    "    invoice: Invoice = billing.invoice_for(order)",
    '    mailer.send("order-shipped", order)',
    '    log = f"{conf.DEBUG!r} {deps.get_user()} {"x"}"', // 35
    "    return order",
    "",
    "",
    "def _helper():",
    "    from shop.services.email import render", // 40
    "    return render",
  ].join("\n"),
  "services/worker/pyproject.toml": '[project]\nname = "worker"\n',
  "services/worker/worker/__init__.py": "",
  "services/worker/worker/jobs.py": "def run():\n    pass\n",
  "services/worker/worker/tasks.py": [
    "from worker.jobs import run", // 1
    "from shop.models import Order",
    "from worker import jobs, VERSION",
    "import worker.jobs, celery",
    "from ... import outside", // 5
  ].join("\n"),
  "tests/helpers.py": "def make_user():\n    pass\n",
  "tests/test_routes.py": [
    "import pytest", // 1
    "from helpers import make_user",
    "from shop.api.routes import router",
    "if True: import shop.models; from shop import settings",
  ].join("\n"),
  ".venv/lib/python3.12/site-packages/fastapi/__init__.py": "from .app import FastAPI\n",
  "node_modules/some-tool/scripts/x.py": "import shop\n",
};

const ctx: AnalyzerContext = {
  baseDir: "/repo",
  files: Object.keys(files).sort(),
  read: async (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`no file ${path}`);
    return text;
  },
};

const deps = await pythonImports.analyze(ctx);
const edgesFrom = (file: string) =>
  deps.filter((d) => d.from === file).map((d) => [d.line, d.specifier, d.to, d.typeOnly ?? false]);

describe("pythonRoots", () => {
  it("finds the repository root, src/, and project directories", () => {
    expect(pythonRoots(ctx)).toEqual(["", "services/worker", "src"]);
  });
});

describe("resolvePythonModule", () => {
  const set = new Set(ctx.files);
  const roots = pythonRoots(ctx);
  const from = "src/shop/api/routes.py";

  it("resolves modules and packages, preferring the package", () => {
    expect(resolvePythonModule(from, "shop.models", set, roots)).toBe("src/shop/models.py");
    expect(resolvePythonModule(from, "shop.services", set, roots)).toBe(
      "src/shop/services/__init__.py",
    );
    expect(resolvePythonModule(from, "shop", set, roots)).toBe("src/shop/__init__.py");
  });

  it("resolves relative modules against the file's package", () => {
    expect(resolvePythonModule(from, ".", set, roots)).toBe("src/shop/api/__init__.py");
    expect(resolvePythonModule(from, ".deps", set, roots)).toBe("src/shop/api/deps.py");
    expect(resolvePythonModule(from, "..models", set, roots)).toBe("src/shop/models.py");
    expect(resolvePythonModule(from, "..", set, roots)).toBe("src/shop/__init__.py");
    expect(resolvePythonModule(from, "....x", set, roots)).toBeUndefined();
  });

  it("leaves the standard library and third-party packages unresolved", () => {
    expect(resolvePythonModule(from, "os.path", set, roots)).toBeUndefined();
    expect(resolvePythonModule(from, "fastapi", set, roots)).toBeUndefined();
    expect(resolvePythonModule(from, "shop.nope", set, roots)).toBeUndefined();
  });
});

describe("pythonImports", () => {
  it("never reads virtualenvs or node_modules", () => {
    expect(deps.some((d) => d.from.includes(".venv/") || d.from.includes("node_modules/"))).toBe(
      false,
    );
    expect(deps.every((d) => d.analyzer === "python-imports")).toBe(true);
  });

  it("resolves absolute, relative, aliased, multi-line, and type-only imports", () => {
    expect(edgesFrom("src/shop/api/routes.py")).toEqual([
      [12, "..models", "src/shop/models.py", false],
      [13, "..services", "src/shop/services/billing.py", false],
      [13, "..services", "src/shop/services/email.py", false],
      [14, ".", "src/shop/api/deps.py", false],
      [15, ".deps", "src/shop/api/deps.py", false],
      [19, "shop.settings", "src/shop/settings.py", false],
      [23, "shop.services.billing", "src/shop/services/billing.py", true],
      [40, "shop.services.email", "src/shop/services/email.py", false],
    ]);
  });

  it("drops the standard library and third-party packages, and falls back to the package", () => {
    expect(edgesFrom("manage.py")).toEqual([
      [4, "shop", "src/shop/settings.py", false],
      [5, "shop.wsgi", "src/shop/__init__.py", false],
    ]);
  });

  it("resolves a package's own names to its __init__.py and submodules to their files", () => {
    expect(edgesFrom("services/worker/worker/tasks.py")).toEqual([
      [1, "worker.jobs", "services/worker/worker/jobs.py", false],
      [2, "shop.models", "src/shop/models.py", false],
      [3, "worker", "services/worker/worker/jobs.py", false],
      [3, "worker", "services/worker/worker/__init__.py", false],
      [4, "worker.jobs", "services/worker/worker/jobs.py", false],
    ]);
    expect(edgesFrom("src/shop/__init__.py")).toEqual([
      [2, ".models", "src/shop/models.py", false],
      [3, ".services", "src/shop/services/__init__.py", false],
    ]);
  });

  it("resolves a script's neighbours and one-line compound statements", () => {
    expect(edgesFrom("tests/test_routes.py")).toEqual([
      [2, "helpers", "tests/helpers.py", false],
      [3, "shop.api.routes", "src/shop/api/routes.py", false],
      [4, "shop.models", "src/shop/models.py", false],
      [4, "shop", "src/shop/settings.py", false],
    ]);
  });

  it("ignores imports in strings and comments", () => {
    const specs = deps.map((d) => d.specifier);
    expect(specs).not.toContain("shop.secret_docstring_import");
    expect(deps.filter((d) => d.from === "src/shop/api/routes.py" && d.line === 27)).toEqual([]);
    expect(deps.filter((d) => d.from === "src/shop/api/routes.py" && d.line === 20)).toEqual([]);
  });
});

describe("indexPythonSource", () => {
  const set = new Set(ctx.files);
  const roots = pythonRoots(ctx);
  const index = (path: string) =>
    indexPythonSource(path, files[path] ?? "", (s) => resolvePythonModule(path, s, set, roots));

  it("narrows exports to a literal __all__ and skips private names", () => {
    const src = index("src/shop/models.py");
    expect(src.exports.map((e) => [e.name, e.kind, e.line])).toEqual([
      ["DEFAULT_STATUS", "const", 11],
      ["OrderStatus", "class", 16],
      ["Order", "class", 22],
      ["make_order", "function", 30],
    ]);
  });

  it("lists module-level functions, classes, and assignments without __all__", () => {
    const src = index("src/shop/settings.py");
    expect(src.exports.map((e) => [e.name, e.kind, e.line])).toEqual([
      ["DEBUG", "const", 3],
      ["CURRENCY", "const", 4],
      ["TAX_RATE", "const", 5],
      ["SHIPPING", "const", 5],
      ["db_url", "const", 6],
      ["LOG_LEVEL", "const", 9],
      ["configure", "function", 18],
      ["handler", "const", 21],
    ]);
    expect(index("src/shop/api/routes.py").exports.map((e) => e.name)).toEqual([
      "router",
      "SQL",
      "get_order",
    ]);
  });

  it("records imported names with their targets and first use", () => {
    const src = index("src/shop/models.py");
    expect(src.imports).toEqual([
      {
        specifier: "__future__",
        target: undefined,
        line: 2,
        names: [{ name: "annotations" }],
      },
      {
        specifier: "enum",
        target: undefined,
        line: 4,
        names: [{ name: "*", local: "enum", line: 16 }],
      },
      {
        specifier: "dataclasses",
        target: undefined,
        line: 5,
        names: [{ name: "dataclass", line: 21 }, { name: "field" }],
      },
      {
        specifier: ".settings",
        target: "src/shop/settings.py",
        line: 7,
        names: [
          { name: "CURRENCY", line: 24 },
          { name: "TAX_RATE", local: "RATE", line: 27 },
        ],
      },
    ]);
  });

  it("splits a statement by target, and marks type-only imports and re-exports", () => {
    const src = index("src/shop/api/routes.py");
    const byLine = (line: number) => src.imports.filter((i) => i.line === line);
    expect(byLine(13)).toEqual([
      {
        specifier: "..services",
        target: "src/shop/services/billing.py",
        line: 13,
        names: [{ name: "billing", line: 33 }],
      },
      {
        specifier: "..services",
        target: "src/shop/services/email.py",
        line: 13,
        names: [{ name: "email", local: "mailer", line: 34 }],
      },
    ]);
    expect(byLine(15)[0]?.names).toEqual([{ name: "get_db", line: 31 }, { name: "get_user" }]);
    expect(byLine(14)[0]?.names).toEqual([{ name: "deps", line: 35 }]);
    expect(byLine(19)[0]?.names).toEqual([{ name: "*", local: "conf", line: 35 }]);
    expect(byLine(23)[0]).toMatchObject({
      target: "src/shop/services/billing.py",
      typeOnly: true,
      names: [{ name: "Invoice", line: 33 }],
    });
    expect(byLine(24)[0]).toMatchObject({ specifier: "sqlalchemy.orm", typeOnly: true });

    const init = index("src/shop/__init__.py");
    expect(init.imports.map((i) => [i.specifier, i.reexport, i.names])).toEqual([
      [".models", true, [{ name: "Order" }]],
      [".services", true, [{ name: "*" }]],
    ]);
    expect(index("src/shop/settings.py").imports.find((i) => i.reexport)?.specifier).toBe(
      ".local_settings",
    );
  });

  it("collects identifier-like string literals, once each", () => {
    expect(index("src/shop/models.py").literals).toEqual([
      { text: "make_order", line: 9 },
      { text: "order-shipped", line: 18 },
    ]);
    expect(index("src/shop/settings.py").literals).toEqual([{ text: "debug-verbose", line: 9 }]);
  });

  it("caps literals", () => {
    const text = Array.from({ length: 150 }, (_, i) => `X${i} = "tool_${i}"`).join("\n");
    expect(indexPythonSource("big.py", text).literals).toHaveLength(100);
  });

  it("indexes every Python file outside virtualenvs", async () => {
    const sources = await indexPythonCode(ctx);
    expect(sources.map((s) => s.path)).toEqual(
      ctx.files.filter(
        (f) => f.endsWith(".py") && !f.startsWith(".venv") && !f.startsWith("node_"),
      ),
    );
  });
});

describe("edge cases", () => {
  const repo = new Set(["app/__init__.py", "app/a.py", "app/b.py", "app/c.py", "app/d.py"]);
  const resolve = (s: string) => resolvePythonModule("app/x.py", s, repo);

  it("ends a TYPE_CHECKING block at its else, and joins backslash continuations", () => {
    const src = indexPythonSource(
      "app/x.py",
      [
        "import typing", // 1
        "if typing.TYPE_CHECKING:",
        "    from .a import A",
        "else:",
        "    from .b import B", // 5
        "from .c \\",
        "    import C",
        "if TYPE_CHECKING: from .d import D",
        "x = '''",
        "from .a import hidden", // 10
        "'''",
      ].join("\n"),
      resolve,
    );
    expect(src.imports.map((i) => [i.line, i.target, i.typeOnly ?? false])).toEqual([
      [1, undefined, false],
      [3, "app/a.py", true],
      [5, "app/b.py", false],
      [6, "app/c.py", false],
      [8, "app/d.py", true],
    ]);
  });

  it("ignores an __all__ that isn't a literal list", () => {
    const text = "from x import y\n__all__ = y.__all__ + ['f']\ndef f(): pass\ndef g(): pass\n";
    expect(indexPythonSource("m.py", text).exports.map((e) => e.name)).toEqual(["f", "g"]);
  });

  it("extends __all__ with +=", () => {
    const text =
      "__all__ = ('f',)\n__all__ += ['g']\ndef f(): pass\ndef g(): pass\ndef h(): pass\n";
    expect(indexPythonSource("m.py", text).exports.map((e) => e.name)).toEqual(["f", "g"]);
  });
});
