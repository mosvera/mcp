// SPDX-License-Identifier: Apache-2.0
//
// Package boundary and provenance for the MCP SDK v2 migration.
// Source stays on the split v2 packages; the monolithic v1 package is neither
// imported, depended on, nor present in the lockfile; the published server
// ships only @modelcontextprotocol/server (the client is test-only); and every
// MCP package in the lockfile resolves from the public npm registry with an
// integrity hash.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { REPO_ROOT } from "./harness.ts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|mts|cts|js|cjs|mjs)$/.test(n) ? [p] : [];
  });
}

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string; resolved?: string; integrity?: string; dev?: boolean }>;
};

it("no source, test or script imports SDK v1", () => {
  const self = join(REPO_ROOT, "test", "wire", "sdk-boundary.test.ts");
  const offenders = [...files(join(REPO_ROOT, "src")), ...files(join(REPO_ROOT, "test")), ...files(join(REPO_ROOT, "scripts"))]
    .filter((f) => f !== self)
    .filter((f) => /@modelcontextprotocol\/sdk\b/.test(readFileSync(f, "utf8")));
  expect(offenders).toEqual([]);
});

it("runtime depends on the v2 server package only; the client is a dev dependency", () => {
  expect(pkg.dependencies["@modelcontextprotocol/sdk"]).toBeUndefined();
  expect(pkg.devDependencies["@modelcontextprotocol/sdk"]).toBeUndefined();
  expect(pkg.dependencies["@modelcontextprotocol/server"]).toMatch(/^\^2\./);
  expect(pkg.dependencies["@modelcontextprotocol/client"]).toBeUndefined();
  expect(pkg.devDependencies["@modelcontextprotocol/client"]).toMatch(/^\^2\./);
});

it("the lockfile carries no SDK v1 and pins every MCP package to the npm registry", () => {
  const mcp = Object.entries(lock.packages).filter(([path]) => path.includes("node_modules/@modelcontextprotocol/"));
  expect(mcp.map(([path]) => path).filter((p) => p.endsWith("/sdk"))).toEqual([]);
  for (const [path, entry] of mcp) {
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    expect(entry.resolved, path).toBe(`https://registry.npmjs.org/${name}/-/${name.split("/")[1]}-${entry.version}.tgz`);
    expect(entry.integrity, path).toMatch(/^sha512-/);
  }
  const prodMcp = mcp.filter(([, e]) => e.dev !== true).map(([p]) => p).sort();
  expect(prodMcp).toEqual(["node_modules/@modelcontextprotocol/core", "node_modules/@modelcontextprotocol/server"]);
});
