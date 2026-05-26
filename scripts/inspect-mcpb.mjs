// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";

const file = process.argv[2];
if (file === undefined) {
  throw new Error("Usage: node scripts/inspect-mcpb.mjs <bundle.mcpb>");
}

const listing = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const required = [
  "manifest.json",
  "icon.png",
  "server/dist/server.js",
  "server/dist/examples/demo-aesthetics/composition.quiet-editorial.json",
  "server/node_modules/@modelcontextprotocol/sdk/package.json",
];
const forbidden = [
  ".env",
  ".envrc",
  ".remember",
  ".vercel",
  ".git/",
  "node_modules/.cache",
  "test/",
  "tests/",
];

const missing = required.filter((entry) => !listing.includes(entry));
const blocked = listing.filter((entry) => forbidden.some((pattern) => entry.includes(pattern)));

if (missing.length > 0 || blocked.length > 0) {
  console.error(JSON.stringify({ missing, blocked }, null, 2));
  process.exit(1);
}

execFileSync("mcpb", ["info", file], { stdio: "inherit" });
console.log(`Inspected ${listing.length} bundle entries.`);
