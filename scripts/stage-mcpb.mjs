// SPDX-License-Identifier: Apache-2.0

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const bundle = resolve(root, "build", "mcpb", "mosvera");
const server = resolve(bundle, "server");

rmSync(bundle, { recursive: true, force: true });
mkdirSync(server, { recursive: true });

cpSync(resolve(root, "mcpb", "manifest.json"), resolve(bundle, "manifest.json"));
cpSync(resolve(root, "mcpb", "icon.png"), resolve(bundle, "icon.png"));
cpSync(resolve(root, "README.md"), resolve(server, "README.md"));
cpSync(resolve(root, "LICENSE"), resolve(server, "LICENSE"));
cpSync(resolve(root, "package.json"), resolve(server, "package.json"));
cpSync(resolve(root, "dist"), resolve(server, "dist"), { recursive: true });

const lockfile = resolve(root, "package-lock.json");
if (existsSync(lockfile)) cpSync(lockfile, resolve(server, "package-lock.json"));

execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts"], {
  cwd: server,
  stdio: "inherit",
});

function pruneDependencyArtifacts(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if ([".cache", "__tests__", "test", "tests"].includes(entry.name)) {
      rmSync(path, { recursive: true, force: true });
      continue;
    }
    pruneDependencyArtifacts(path);
  }
}

pruneDependencyArtifacts(resolve(server, "node_modules"));

console.log(`Staged MCPB bundle at ${bundle}`);
